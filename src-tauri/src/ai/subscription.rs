//! Native-only OAuth for the official Sign in with ChatGPT public-client flow.
//! Tokens, PKCE and callbacks never cross IPC. One saved registration per provider.
use super::keys::KeyStore;
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
    signature,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
const ISSUER: &str = "https://auth.openai.com";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

fn error(message: &str) -> AppError {
    AppError::Ai(message.into())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random() -> AppResult<String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| error("Could not create a secure sign-in request"))?;
    Ok(B64.encode(bytes))
}
fn host_id() -> AppResult<String> {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| error("Could not create a host identifier"))?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    ))
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Record {
    host: String,
    client_id: String,
    subject: String,
    email: Option<String>,
    access_token: String,
    refresh_token: String,
    id_token: String,
    scope: String,
    expires_at: u64,
}
impl Record {
    fn connected(&self) -> bool {
        !self.access_token.is_empty()
            && !self.client_id.is_empty()
            && !self.subject.is_empty()
            && permitted(&self.scope)
    }
}
fn permitted(scope: &str) -> bool {
    ["resource.invoke", "chatgpt.tokens.use.direct"]
        .iter()
        .all(|s| scope.split_whitespace().any(|v| v == *s))
}
// This mutex also fences saves against cancellation, deletion and settings changes.
#[derive(Default)]
struct State {
    epochs: HashMap<String, u64>,
    pending: HashMap<String, Arc<AtomicBool>>,
}
pub struct Sessions {
    keys: Arc<dyn KeyStore>,
    lock_path: std::path::PathBuf,
    state: Mutex<State>,
    refresh: tauri::async_runtime::Mutex<()>,
}
impl Sessions {
    pub fn new(keys: Arc<dyn KeyStore>, lock_path: std::path::PathBuf) -> Self {
        Self {
            keys,
            lock_path,
            state: Mutex::new(State::default()),
            refresh: tauri::async_runtime::Mutex::new(()),
        }
    }
    fn lock_session(&self) -> AppResult<std::fs::File> {
        if let Some(parent) = self.lock_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.lock_path)?;
        fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
            error("Another AXISNotes window is updating the ChatGPT connection. Please try again.")
        })?;
        Ok(file) // OS releases the advisory lock on drop, including after a process crash.
    }
    fn installation_host(&self) -> AppResult<String> {
        let _lock = self.lock_session()?;
        let path = self.lock_path.with_file_name("chatgpt-host-id");
        if path.exists() {
            return std::fs::read_to_string(path).map_err(Into::into);
        }
        let host = host_id()?;
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, &host)?;
        std::fs::rename(temporary, path)?;
        Ok(host)
    }
    fn storage_id(id: &str) -> String {
        format!("chatgpt-session:{id}")
    }
    fn parts(value: &Value) -> AppResult<Option<(String, usize)>> {
        let Some(n) = value.get("chunks") else {
            return Ok(None);
        };
        let count =
            n.as_u64()
                .filter(|n| *n > 0 && *n <= 128)
                .ok_or_else(|| error("Invalid ChatGPT keychain manifest"))? as usize;
        let generation = value["generation"]
            .as_str()
            .filter(|s| {
                s.len() == 43
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            })
            .ok_or_else(|| error("Invalid ChatGPT keychain generation"))?;
        Ok(Some((generation.into(), count)))
    }
    fn clear_parts(&self, id: &str, value: &Value) -> AppResult<()> {
        if let Some((generation, count)) = Self::parts(value)? {
            for i in 0..count {
                self.keys
                    .delete(&format!("{}:{generation}:{i}", Self::storage_id(id)))?;
            }
        }
        Ok(())
    }
    fn load(&self, id: &str) -> AppResult<Record> {
        let Some(raw) = self.keys.get(&Self::storage_id(id))? else {
            return Ok(Record::default());
        };
        let value: Value = serde_json::from_str(&raw).map_err(|_| error("Saved ChatGPT connection is unreadable. Remove this provider and add it again; manage remote access in ChatGPT settings."))?;
        if let Some((generation, count)) = Self::parts(&value)? {
            let mut bytes = Vec::new();
            for i in 0..count {
                let part = self.keys.get(&format!("{}:{generation}:{i}", Self::storage_id(id)))?
                    .ok_or_else(|| error("ChatGPT credential entry is missing. Remove this provider and add it again."))?;
                if part.len() > 800 {
                    return Err(error("Invalid ChatGPT credential entry"));
                }
                bytes.extend(decoded(&part)?);
            }
            serde_json::from_slice(&bytes).map_err(|_| error("Invalid ChatGPT credential record"))
        } else {
            // Small legacy/test records; never exposed over IPC.
            serde_json::from_value(value).map_err(|_| error("Invalid ChatGPT credential record"))
        }
    }
    fn save(&self, id: &str, record: &Record) -> AppResult<()> {
        // Windows passwords are UTF-16 with a 2,560-byte blob ceiling. OAuth sets
        // exceed it. Each entry below is <=800 ASCII characters (1,600 bytes).
        // Publish the manifest last so readers see either complete generation.
        let previous = self.keys.get(&Self::storage_id(id))?;
        let bytes =
            serde_json::to_vec(record).map_err(|_| error("Could not encode ChatGPT connection"))?;
        let chunks: Vec<_> = bytes.chunks(600).collect();
        if chunks.len() > 128 {
            return Err(error("ChatGPT credential record is too large"));
        }
        let generation = random()?;
        let mut saved = Vec::new();
        let result = (|| {
            for (i, part) in chunks.iter().enumerate() {
                let key = format!("{}:{generation}:{i}", Self::storage_id(id));
                self.keys.set(&key, &B64.encode(part))?;
                saved.push(key);
            }
            self.keys.set(
                &Self::storage_id(id),
                &serde_json::json!({"generation":generation,"chunks":chunks.len()}).to_string(),
            )
        })();
        if result.is_err() {
            for key in saved {
                let _ = self.keys.delete(&key);
            }
            return result;
        }
        if let Some(old) = previous.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            self.clear_parts(id, &old)?;
        }
        Ok(())
    }
    pub fn forget(&self, id: &str) -> AppResult<()> {
        self.cancel(id);
        let raw = self.keys.get(&Self::storage_id(id))?;
        if let Some(value) = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            self.clear_parts(id, &value)?;
        }
        self.keys.delete(&Self::storage_id(id))
    }
    pub fn status(&self, id: &str) -> (bool, Option<String>) {
        self.load(id)
            .map(|r| (r.connected(), r.email))
            .unwrap_or((false, None))
    }
    pub fn cancel(&self, id: &str) {
        let mut state = self.state.lock().unwrap();
        *state.epochs.entry(id.into()).or_default() += 1;
        if let Some(flag) = state.pending.get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    fn commit(&self, id: &str, epoch: u64, record: &Record) -> AppResult<()> {
        let state = self.state.lock().unwrap();
        if state.epochs.get(id).copied().unwrap_or_default() != epoch {
            return Err(AppError::Cancelled);
        }
        self.save(id, record)
    }
    pub async fn sign_in(&self, id: &str) -> AppResult<()> {
        let cancel = Arc::new(AtomicBool::new(false));
        let (epoch, mut record) = {
            let mut state = self.state.lock().unwrap();
            if state.pending.contains_key(id) {
                return Err(error("A ChatGPT sign-in is already open"));
            }
            let epoch = *state.epochs.entry(id.into()).or_default();
            let mut r = self.load(id)?;
            if r.host.is_empty() {
                r.host = self.installation_host()?;
                self.save(id, &r)?;
            }
            state.pending.insert(id.into(), cancel.clone());
            (epoch, r)
        };
        let result = self.authorize(id, epoch, &mut record, cancel.clone()).await;
        let mut state = self.state.lock().unwrap();
        if state
            .pending
            .get(id)
            .is_some_and(|v| Arc::ptr_eq(v, &cancel))
        {
            state.pending.remove(id);
        }
        result
    }
    async fn authorize(
        &self,
        id: &str,
        epoch: u64,
        record: &mut Record,
        cancel: Arc<AtomicBool>,
    ) -> AppResult<()> {
        let state = random()?;
        let nonce = random()?;
        let verifier = random()?;
        let server = tiny_http::Server::http("127.0.0.1:0")
            .map_err(|_| error("Could not start the local ChatGPT sign-in callback"))?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| error("Invalid callback address"))?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/auth/callback");
        let initial = record.client_id.is_empty();
        let client_id = if initial {
            "dynamic_agent_client"
        } else {
            record.client_id.as_str()
        };
        let mut url =
            reqwest::Url::parse("https://auth.openai.com/api/accounts/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", redirect.as_str()),
            ("scope", SCOPES),
            ("resource", RESOURCE),
            ("state", state.as_str()),
            ("nonce", nonce.as_str()),
            ("code_challenge_method", "S256"),
            (
                "code_challenge",
                B64.encode(digest::digest(&digest::SHA256, verifier.as_bytes()))
                    .as_str(),
            ),
            ("ext_agent_host_id", record.host.as_str()),
        ]);
        if initial {
            url.query_pairs_mut()
                .append_pair("agent_name_hint", "AXISNotes");
        } else if !record.id_token.is_empty() {
            url.query_pairs_mut()
                .append_pair("id_token_hint", &record.id_token);
        }
        open_browser(url.as_str())?;
        let expected = state.clone();
        let callback =
            tauri::async_runtime::spawn_blocking(move || {
                let started = Instant::now();
                while started.elapsed() < Duration::from_secs(180) {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(AppError::Cancelled);
                    }
                    let Some(req) = server
                        .recv_timeout(Duration::from_millis(200))
                        .map_err(|_| error("Sign-in callback failed"))?
                    else {
                        continue;
                    };
                    // No CORS or remote origins on this narrowly scoped listener.
                    if req.method() != &tiny_http::Method::Get
                        || req.url().len() > 16384
                        || req.headers().iter().any(|h| h.field.equiv("Origin"))
                    {
                        let _ = req.respond(
                            tiny_http::Response::from_string("Invalid callback")
                                .with_status_code(400),
                        );
                        continue;
                    }
                    let parsed = callback(req.url(), &expected);
                    let body = if parsed.is_ok() {
                        "Return to AXISNotes to finish connecting."
                    } else {
                        "Invalid sign-in callback. Return to AXISNotes."
                    };
                    let valid = parsed.is_ok();
                    let response = tiny_http::Response::from_string(body)
                        .with_status_code(if valid { 200 } else { 400 });
                    let _ = req.respond(response);
                    if let Ok(values) = parsed {
                        return Ok(values);
                    }
                }
                Err(error("ChatGPT sign-in timed out. Please try again."))
            })
            .await
            .map_err(|_| error("Sign-in callback stopped"))??;
        if callback.contains_key("error") {
            return Err(error(
                "ChatGPT sign-in was declined. Your existing connection was kept.",
            ));
        }
        let code = callback
            .get("code")
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("Sign-in did not return a code"))?;
        let issued = callback.get("client_id").filter(|s| !s.is_empty());
        let client_id = if initial {
            issued
                .filter(|s| s.as_str() != "dynamic_agent_client")
                .ok_or_else(|| error("ChatGPT client registration was incomplete"))?
                .clone()
        } else {
            if issued.is_some_and(|s| s != &record.client_id) {
                return Err(error("ChatGPT returned a different client registration"));
            }
            record.client_id.clone()
        };
        let http = client()?;
        let value = exchange(
            &http,
            &[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id),
                ("code", code),
                ("code_verifier", &verifier),
                ("redirect_uri", &redirect),
                ("resource", RESOURCE),
            ],
        )
        .await?;
        let token = value["id_token"]
            .as_str()
            .ok_or_else(|| error("ChatGPT did not return an identity token"))?;
        let jwks = jwks(&http).await?;
        let claims = validate_identity(token, &jwks, &client_id, Some(&nonce), now())?;
        if !record.subject.is_empty() && claims["sub"].as_str() != Some(&record.subject) {
            return Err(error(
                "ChatGPT account changed. Add a separate provider for a different account.",
            ));
        }
        record.client_id = client_id;
        record.subject = claims["sub"].as_str().unwrap().into();
        record.email = claims["email"].as_str().map(String::from);
        record.id_token = token.into();
        apply_tokens(record, &value, false)?;
        let _file_lock = self.lock_session()?;
        self.commit(id, epoch, record)
    }
    pub async fn access_token(&self, id: &str) -> AppResult<String> {
        // Refresh tokens rotate: serialize refreshes for this native service instance.
        let _refresh = self.refresh.lock().await;
        let _file_lock = self.lock_session()?;
        let (epoch, mut record) = {
            let state = self.state.lock().unwrap();
            (
                state.epochs.get(id).copied().unwrap_or_default(),
                self.load(id)?,
            )
        };
        if !record.connected() {
            return Err(error("Connect your ChatGPT plan in Settings → AI"));
        }
        if record.expires_at > now() + 60 {
            return Ok(record.access_token);
        }
        if record.refresh_token.is_empty() {
            return Err(error("Your ChatGPT connection expired. Sign in again."));
        }
        let http = client()?;
        let value = exchange(
            &http,
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &record.client_id),
                ("refresh_token", &record.refresh_token),
                ("resource", RESOURCE),
            ],
        )
        .await?;
        if let Some(token) = value["id_token"].as_str() {
            let claims =
                validate_identity(token, &jwks(&http).await?, &record.client_id, None, now())?;
            if claims["sub"].as_str() != Some(&record.subject) {
                return Err(error(
                    "ChatGPT account changed during refresh. Sign in again.",
                ));
            }
            record.id_token = token.into();
        }
        apply_tokens(&mut record, &value, true)?;
        self.commit(id, epoch, &record)?;
        Ok(record.access_token)
    }
    pub async fn disconnect(&self, id: &str) -> AppResult<()> {
        self.cancel(id);
        let _refresh = self.refresh.lock().await;
        let _file_lock = self.lock_session()?;
        let mut record = self.load(id)?;
        let renewable = record.refresh_token.clone();
        let client_id = record.client_id.clone();
        record.access_token.clear();
        record.refresh_token.clear();
        record.id_token.clear();
        record.scope.clear();
        record.expires_at = 0;
        self.save(id, &record)?;
        if renewable.is_empty() {
            return Ok(());
        }
        let http = client()?;
        // Discover the official revocation endpoint; never accept an off-origin URL.
        let result = async {
            let discovery = http
                .get(format!("{ISSUER}/.well-known/openid-configuration"))
                .send()
                .await
                .ok()?
                .error_for_status()
                .ok()?
                .json::<Value>()
                .await
                .ok()?;
            let endpoint = reqwest::Url::parse(discovery["revocation_endpoint"].as_str()?).ok()?;
            if endpoint.origin() != reqwest::Url::parse(ISSUER).ok()?.origin() {
                return None;
            }
            http.post(endpoint)
                .form(&[
                    ("token", renewable.as_str()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", client_id.as_str()),
                ])
                .send()
                .await
                .ok()?
                .status()
                .is_success()
                .then_some(())
        }
        .await;
        if result.is_none() {
            return Err(error("Disconnected locally. Remote sign-out could not be confirmed; disconnect AXISNotes in ChatGPT Settings → Usage."));
        }
        Ok(())
    }
}
fn client() -> AppResult<reqwest::Client> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| error("Could not create the ChatGPT sign-in client"))
}
async fn exchange(http: &reqwest::Client, fields: &[(&str, &str)]) -> AppResult<Value> {
    let response = http
        .post(TOKEN)
        .form(fields)
        .send()
        .await
        .map_err(|_| error("Could not reach ChatGPT sign-in. Please try again."))?;
    if !response.status().is_success() {
        return Err(error(
            "ChatGPT authorization expired or was rejected. Sign in again.",
        ));
    }
    response
        .json()
        .await
        .map_err(|_| error("Invalid ChatGPT authorization response"))
}
async fn jwks(http: &reqwest::Client) -> AppResult<Value> {
    http.get(format!("{ISSUER}/.well-known/jwks.json"))
        .send()
        .await
        .map_err(|_| error("Could not verify ChatGPT identity"))?
        .error_for_status()
        .map_err(|_| error("Could not verify ChatGPT identity"))?
        .json()
        .await
        .map_err(|_| error("Invalid ChatGPT signing keys"))
}
fn apply_tokens(record: &mut Record, value: &Value, refreshing: bool) -> AppResult<()> {
    let access = value["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("ChatGPT did not grant API access"))?;
    if !value["token_type"]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case("Bearer"))
    {
        return Err(error("Unexpected ChatGPT token type"));
    }
    let scope = value["scope"]
        .as_str()
        .or_else(|| refreshing.then_some(record.scope.as_str()))
        .unwrap_or("");
    if !permitted(scope) {
        return Err(error(
            "ChatGPT plan usage was not authorized. Sign in and allow AXISNotes to use your plan.",
        ));
    }
    let expires = value["expires_in"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(|| error("ChatGPT did not return token expiry"))?;
    record.scope = scope.into();
    record.access_token = access.into();
    record.expires_at = now().saturating_add(expires);
    if let Some(refresh) = value["refresh_token"].as_str().filter(|s| !s.is_empty()) {
        record.refresh_token = refresh.into();
    }
    Ok(())
}
fn callback(path: &str, expected_state: &str) -> AppResult<HashMap<String, String>> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| error("Invalid callback"))?;
    if url.path() != "/auth/callback" || url.fragment().is_some() {
        return Err(error("Invalid callback path"));
    }
    let mut values = HashMap::new();
    for (k, v) in url.query_pairs() {
        if values.insert(k.into_owned(), v.into_owned()).is_some() {
            return Err(error("Duplicate callback parameter"));
        }
    }
    if values.get("state").map(String::as_str) != Some(expected_state) {
        return Err(error("Invalid sign-in state"));
    }
    Ok(values)
}
fn decoded(s: &str) -> AppResult<Vec<u8>> {
    B64.decode(s).map_err(|_| error("Invalid identity token"))
}
fn validate_identity(
    token: &str,
    jwks: &Value,
    audience: &str,
    nonce: Option<&str>,
    time: u64,
) -> AppResult<Value> {
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(error("Invalid identity token"));
    }
    let header: Value = serde_json::from_slice(&decoded(parts[0])?)
        .map_err(|_| error("Invalid identity token header"))?;
    if header["alg"] != "RS256" {
        return Err(error("Unsupported ChatGPT identity signing algorithm"));
    }
    let kid = header["kid"]
        .as_str()
        .ok_or_else(|| error("Missing identity signing key"))?;
    let key = jwks["keys"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|k| {
                k["kid"] == kid
                    && k["kty"] == "RSA"
                    && k.get("use").is_none_or(|v| v == "sig")
                    && k.get("alg").is_none_or(|v| v == "RS256")
            })
        })
        .ok_or_else(|| error("Unknown ChatGPT identity signing key"))?;
    let n = decoded(
        key["n"]
            .as_str()
            .ok_or_else(|| error("Invalid signing key"))?,
    )?;
    let e = decoded(
        key["e"]
            .as_str()
            .ok_or_else(|| error("Invalid signing key"))?,
    )?;
    signature::RsaPublicKeyComponents {
        n: n.as_slice(),
        e: e.as_slice(),
    }
    .verify(
        &signature::RSA_PKCS1_2048_8192_SHA256,
        format!("{}.{}", parts[0], parts[1]).as_bytes(),
        &decoded(parts[2])?,
    )
    .map_err(|_| error("ChatGPT identity signature was rejected"))?;
    let claims: Value = serde_json::from_slice(&decoded(parts[1])?)
        .map_err(|_| error("Invalid identity claims"))?;
    let aud = &claims["aud"];
    let audience_ok = aud == audience
        || aud
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v == audience));
    let azp_ok = claims.get("azp").is_none_or(|v| v == audience)
        && (!aud.as_array().is_some_and(|a| a.len() > 1) || claims["azp"] == audience);
    if claims["iss"] != ISSUER
        || !audience_ok
        || !azp_ok
        || !claims["exp"].as_u64().is_some_and(|n| n > time)
        || !claims["iat"].as_u64().is_some_and(|n| n <= time + 60)
        || claims["nbf"].as_u64().is_some_and(|n| n > time + 5)
        || !claims["sub"].as_str().is_some_and(|s| !s.is_empty())
        || nonce.is_some_and(|n| claims["nonce"] != n)
    {
        return Err(error("ChatGPT identity claims were rejected"));
    }
    Ok(claims)
}
pub fn open_usage() -> AppResult<()> {
    open_browser("https://chatgpt.com/#settings/Usage")
}
fn open_browser(url: &str) -> AppResult<()> {
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut command = std::process::Command::new(program);
    command.arg(url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| error("Could not open your browser for ChatGPT"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_callbacks() {
        assert!(callback("/auth/callback?code=good&state=expected", "expected").is_ok());
        for path in [
            "/auth/callback?code=x&state=wrong",
            "/callback?state=expected",
            "/auth/callback?state=expected&state=expected",
        ] {
            assert!(callback(path, "expected").is_err());
        }
    }
    #[test]
    fn consent_is_required_and_refresh_preserves_it() {
        let mut r = Record::default();
        let mut v = serde_json::json!({"access_token":"test-access", "refresh_token":"test-refresh", "token_type":"Bearer", "expires_in":3600, "scope":"openid email"});
        assert!(apply_tokens(&mut r, &v, false).is_err());
        v["scope"] = Value::from(SCOPES);
        apply_tokens(&mut r, &v, false).unwrap();
        v.as_object_mut().unwrap().remove("scope");
        v["refresh_token"] = Value::from("rotated");
        apply_tokens(&mut r, &v, true).unwrap();
        assert_eq!(r.refresh_token, "rotated");
        assert!(permitted(&r.scope));
    }
    #[test]
    fn cancel_fences_late_credentials() {
        let keys = Arc::new(super::super::keys::MemoryKeys::default());
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(keys.clone(), dir.path().join("session.lock"));
        sessions.cancel("plan");
        assert!(sessions.commit("plan", 0, &Record::default()).is_err());
        assert!(keys.get("chatgpt-session:plan").unwrap().is_none());
    }
    #[test]
    fn large_token_sets_fit_windows_keychain_and_replace_atomically() {
        struct Limited(super::super::keys::MemoryKeys);
        impl KeyStore for Limited {
            fn get(&self, id: &str) -> AppResult<Option<String>> {
                self.0.get(id)
            }
            fn set(&self, id: &str, key: &str) -> AppResult<()> {
                assert!(key.encode_utf16().count() * 2 <= 2560);
                self.0.set(id, key)
            }
            fn delete(&self, id: &str) -> AppResult<()> {
                self.0.delete(id)
            }
        }
        let keys = Arc::new(Limited(super::super::keys::MemoryKeys::default()));
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::new(keys.clone(), dir.path().join("session.lock"));
        let record = Record {
            access_token: "access".repeat(1200),
            refresh_token: "refresh".repeat(500),
            id_token: "identity".repeat(600),
            ..Record::default()
        };
        sessions.save("p", &record).unwrap();
        assert_eq!(
            sessions.load("p").unwrap().access_token,
            record.access_token
        );
        let old: Value =
            serde_json::from_str(&keys.get("chatgpt-session:p").unwrap().unwrap()).unwrap();
        sessions.save("p", &Record::default()).unwrap();
        let (generation, count) = Sessions::parts(&old).unwrap().unwrap();
        for i in 0..count {
            assert!(keys
                .get(&format!("chatgpt-session:p:{generation}:{i}"))
                .unwrap()
                .is_none());
        }
        sessions.forget("p").unwrap();
        assert!(keys.get("chatgpt-session:p").unwrap().is_none());
    }
    #[test]
    fn installation_host_survives_registration_and_process_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.lock");
        let keys = Arc::new(super::super::keys::MemoryKeys::default());
        let a = Sessions::new(keys.clone(), path.clone());
        let b = Sessions::new(keys, path);
        let host = a.installation_host().unwrap();
        assert!(host.starts_with("urn:uuid:"));
        assert_eq!(host, b.installation_host().unwrap());
    }
    #[test]
    fn refresh_lock_is_shared_across_native_instances() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.lock");
        let keys = Arc::new(super::super::keys::MemoryKeys::default());
        let a = Sessions::new(keys.clone(), path.clone());
        let b = Sessions::new(keys, path);
        let guard = a.lock_session().unwrap();
        assert!(b.lock_session().is_err());
        drop(guard);
        assert!(b.lock_session().is_ok());
    }
    #[test]
    fn validates_signed_identity() {
        let fixture: Value =
            serde_json::from_str(include_str!("fixtures/chatgpt_identity.json")).unwrap();
        let token = fixture["token"].as_str().unwrap();
        let jwks = &fixture["jwks"];
        assert!(validate_identity(token, jwks, "oaiapp_test", Some("test-nonce"), 1000).is_ok());
        assert!(validate_identity(token, jwks, "wrong", Some("test-nonce"), 1000).is_err());
        assert!(validate_identity(token, jwks, "oaiapp_test", Some("wrong"), 1000).is_err());
        assert!(validate_identity(token, jwks, "oaiapp_test", Some("test-nonce"), 10000).is_err());
        let mut parts: Vec<String> = token.split('.').map(String::from).collect();
        parts[1] = B64.encode(br#"{"sub":"tampered"}"#);
        assert!(validate_identity(&parts.join("."), jwks, "oaiapp_test", None, 1000).is_err());
    }
}
