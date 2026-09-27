//! Web clipper endpoint: a small HTTP server on 127.0.0.1 that the AXISNotes browser extension
//! sends clips to. A browser is paired once with a short-lived code shown in the app and
//! gets a long random token; only a hash of the token is stored (in the app config
//! folder, never in the vault). Requests from web pages (an `http(s)://` Origin) are
//! refused outright, so sites can't talk to the endpoint even though it's on localhost.

mod render;

use std::collections::VecDeque;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use ring::rand::SecureRandom;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::vault::Vault;

pub use render::{render_clip, Clip};

pub const DEFAULT_PORT: u16 = 38417;
const MAX_BODY: usize = 25 * 1024 * 1024;
const PAIRING_TTL: Duration = Duration::from_secs(300);
const MAX_PAIRING_ATTEMPTS: u32 = 5;
const RECENT_IDS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    /// SHA-256 of the token, hex.
    pub token_hash: String,
    pub created_ms: u64,
    pub last_used_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ClipperConfig {
    pub enabled: bool,
    pub port: u16,
    /// Vault folder that clips go into.
    pub folder: String,
    pub devices: Vec<Device>,
    /// Ids of recent clips, so a retried delivery doesn't create a duplicate.
    pub recent: VecDeque<String>,
}

impl Default for ClipperConfig {
    fn default() -> Self {
        ClipperConfig {
            enabled: true,
            port: DEFAULT_PORT,
            folder: "Clippings".into(),
            devices: Vec::new(),
            recent: VecDeque::new(),
        }
    }
}

impl ClipperConfig {
    fn load(path: &PathBuf) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &PathBuf) -> AppResult<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self).unwrap())?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }
}

/// What the settings screen shows (no token hashes).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipperStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub folder: String,
    pub error: Option<String>,
    pub devices: Vec<DeviceView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
    pub last_used_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingCode {
    pub code: String,
    pub expires_in_secs: u64,
}

struct Pairing {
    code: String,
    expires: Instant,
    attempts: u32,
}

/// A request as the handler sees it (decoupled from the HTTP library, for tests).
pub struct Req<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub body: &'a [u8],
}

#[derive(Debug, PartialEq)]
pub struct Resp {
    pub status: u16,
    pub body: Value,
}

fn resp(status: u16, body: Value) -> Resp {
    Resp { status, body }
}

fn error(status: u16, msg: &str) -> Resp {
    resp(status, json!({ "error": msg }))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sha256_hex(s: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, s.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    ring::rand::SystemRandom::new()
        .fill(&mut buf)
        .expect("system random");
    buf
}

type VaultFn = dyn Fn() -> Option<Vault> + Send + Sync;
type ClipFn = dyn Fn(&str, &str) + Send + Sync;

pub struct Clipper {
    config_path: PathBuf,
    config: Mutex<ClipperConfig>,
    pairing: Mutex<Option<Pairing>>,
    server: Mutex<Option<Arc<tiny_http::Server>>>,
    error: Mutex<Option<String>>,
    vault: Box<VaultFn>,
    /// Called with (note path, title) after each saved clip.
    on_clip: Box<ClipFn>,
}

impl Clipper {
    pub fn new(
        config_path: PathBuf,
        vault: impl Fn() -> Option<Vault> + Send + Sync + 'static,
        on_clip: impl Fn(&str, &str) + Send + Sync + 'static,
    ) -> Self {
        let config = ClipperConfig::load(&config_path);
        Clipper {
            config_path,
            config: Mutex::new(config),
            pairing: Mutex::new(None),
            server: Mutex::new(None),
            error: Mutex::new(None),
            vault: Box::new(vault),
            on_clip: Box::new(on_clip),
        }
    }

    fn update(&self, f: impl FnOnce(&mut ClipperConfig)) -> AppResult<()> {
        let mut c = self.config.lock().unwrap();
        f(&mut c);
        c.save(&self.config_path)
    }

    pub fn config(&self) -> ClipperConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn status(&self) -> ClipperStatus {
        let c = self.config();
        // Separate statements: a guard held across `self.port()` would deadlock.
        let running = self.server.lock().unwrap().is_some();
        let port = self.port();
        ClipperStatus {
            enabled: c.enabled,
            running,
            port,
            folder: c.folder,
            error: self.error.lock().unwrap().clone(),
            devices: c
                .devices
                .into_iter()
                .map(|d| DeviceView {
                    id: d.id,
                    name: d.name,
                    created_ms: d.created_ms,
                    last_used_ms: d.last_used_ms,
                })
                .collect(),
        }
    }

    /// The port actually listened on (may differ from the configured one in tests).
    pub fn port(&self) -> u16 {
        self.server
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|s| s.server_addr().to_ip().map(|a| a.port()))
            .unwrap_or_else(|| self.config().port)
    }

    /// Show a new 6-digit pairing code (valid for 5 minutes, 5 attempts).
    pub fn start_pairing(&self) -> PairingCode {
        let n = u32::from_le_bytes(random_bytes::<4>()) % 1_000_000;
        let code = format!("{n:06}");
        *self.pairing.lock().unwrap() = Some(Pairing {
            code: code.clone(),
            expires: Instant::now() + PAIRING_TTL,
            attempts: 0,
        });
        PairingCode {
            code,
            expires_in_secs: PAIRING_TTL.as_secs(),
        }
    }

    pub fn cancel_pairing(&self) {
        *self.pairing.lock().unwrap() = None;
    }

    pub fn revoke(&self, id: &str) -> AppResult<()> {
        self.update(|c| c.devices.retain(|d| d.id != id))
    }

    pub fn set_folder(&self, folder: &str) -> AppResult<()> {
        let folder = folder.trim().trim_matches('/').to_string();
        if folder.is_empty() || folder.split('/').any(|p| p == ".." || p.starts_with('.')) {
            return Err(AppError::InvalidName(folder));
        }
        self.update(|c| c.folder = folder)
    }

    /// Handle one request.
    pub fn handle(&self, req: &Req) -> Resp {
        // Web pages must never reach the endpoint (extensions send their own origin).
        if let Some(o) = req.origin {
            let o = o.to_ascii_lowercase();
            if o.starts_with("http://") || o.starts_with("https://") || o == "null" {
                return error(403, "requests from web pages are not allowed");
            }
        }
        match (req.method, req.path) {
            ("GET", "/v1/status") => resp(
                200,
                json!({
                    "app": "AXISNotes",
                    "version": env!("CARGO_PKG_VERSION"),
                    "vault": (self.vault)().is_some(),
                    "paired": req.authorization.is_some_and(|a| self.device_for(a).is_some()),
                }),
            ),
            ("POST", "/v1/pair") => self.pair(req.body),
            ("POST", "/v1/clip") => {
                let Some(device) = req.authorization.and_then(|a| self.device_for(a)) else {
                    return error(
                        401,
                        "not paired: pair this browser in AXISNotes → Settings → Web clipper",
                    );
                };
                self.clip(&device, req.body)
            }
            (_, "/v1/status" | "/v1/pair" | "/v1/clip") => error(405, "method not allowed"),
            _ => error(404, "not found"),
        }
    }

    fn device_for(&self, authorization: &str) -> Option<String> {
        let token = authorization.strip_prefix("Bearer ")?.trim();
        if token.len() < 32 {
            return None;
        }
        let hash = sha256_hex(token);
        let c = self.config.lock().unwrap();
        c.devices
            .iter()
            .find(|d| d.token_hash == hash)
            .map(|d| d.id.clone())
    }

    fn pair(&self, body: &[u8]) -> Resp {
        #[derive(Deserialize)]
        struct PairBody {
            code: String,
            #[serde(default)]
            name: String,
        }
        let Ok(b) = serde_json::from_slice::<PairBody>(body) else {
            return error(400, "expected {\"code\", \"name\"}");
        };
        {
            let mut guard = self.pairing.lock().unwrap();
            let Some(p) = guard.as_mut() else {
                return error(
                    403,
                    "no pairing in progress: click “Pair a browser” in AXISNotes first",
                );
            };
            if Instant::now() > p.expires {
                *guard = None;
                return error(403, "the pairing code expired; show a new one in AXISNotes");
            }
            if p.code != b.code.trim() {
                p.attempts += 1;
                if p.attempts >= MAX_PAIRING_ATTEMPTS {
                    *guard = None;
                    return error(429, "too many wrong codes; show a new one in AXISNotes");
                }
                return error(403, "wrong pairing code");
            }
            *guard = None;
        }
        let token: String = random_bytes::<32>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let id: String = random_bytes::<8>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let name = match b.name.trim() {
            "" => "Browser".to_string(),
            n => n.chars().take(60).collect(),
        };
        let device = Device {
            id: id.clone(),
            name,
            token_hash: sha256_hex(&token),
            created_ms: now_ms(),
            last_used_ms: None,
        };
        if let Err(e) = self.update(|c| c.devices.push(device)) {
            return error(500, &e.to_string());
        }
        resp(200, json!({ "token": token, "deviceId": id }))
    }

    fn clip(&self, device: &str, body: &[u8]) -> Resp {
        let clip: Clip = match serde_json::from_slice(body) {
            Ok(c) => c,
            Err(e) => return error(400, &format!("invalid clip: {e}")),
        };
        let Some(vault) = (self.vault)() else {
            return error(
                503,
                "no vault is open in AXISNotes; the clip will be sent again later",
            );
        };
        let config = self.config();
        if let Some(id) = &clip.id {
            if config.recent.contains(id) {
                return resp(200, json!({ "duplicate": true }));
            }
        }
        let rendered = match render_clip(&clip, &config.folder, now_ms(), |rel| {
            vault.resolve(rel).map(|p| p.exists()).unwrap_or(true)
        }) {
            Ok(r) => r,
            Err(e) => return error(400, &e),
        };
        if let Some((rel, data)) = &rendered.attachment {
            let bytes = match base64::engine::general_purpose::STANDARD.decode(data) {
                Ok(b) => b,
                Err(_) => return error(400, "the screenshot is not valid base64"),
            };
            if let Err(e) = vault.write_bytes(rel, &bytes) {
                return error(500, &e.to_string());
            }
        }
        if let Err(e) = vault.write_file(&rendered.note, &rendered.content, None) {
            return error(500, &e.to_string());
        }
        let _ = self.update(|c| {
            if let Some(id) = &clip.id {
                c.recent.push_back(id.clone());
                while c.recent.len() > RECENT_IDS {
                    c.recent.pop_front();
                }
            }
            if let Some(d) = c.devices.iter_mut().find(|d| d.id == device) {
                d.last_used_ms = Some(now_ms());
            }
        });
        (self.on_clip)(&rendered.note, &rendered.title);
        resp(201, json!({ "path": rendered.note }))
    }

    /// Start (or restart) the server if the clipper is enabled.
    pub fn start(self: &Arc<Self>) {
        self.stop();
        let config = self.config();
        if !config.enabled {
            return;
        }
        self.start_on(config.port);
    }

    pub fn start_on(self: &Arc<Self>, port: u16) {
        let server = match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(s) => Arc::new(s),
            Err(e) => {
                *self.error.lock().unwrap() =
                    Some(format!("couldn't listen on 127.0.0.1:{port}: {e}"));
                return;
            }
        };
        *self.error.lock().unwrap() = None;
        *self.server.lock().unwrap() = Some(server.clone());
        let me = Arc::clone(self);
        std::thread::Builder::new()
            .name("axis-clipper".into())
            .spawn(move || {
                for request in server.incoming_requests() {
                    me.serve(request);
                }
            })
            .expect("spawn clipper thread");
    }

    pub fn stop(&self) {
        if let Some(s) = self.server.lock().unwrap().take() {
            s.unblock();
        }
    }

    pub fn set_enabled(self: &Arc<Self>, enabled: bool) -> AppResult<()> {
        self.update(|c| c.enabled = enabled)?;
        if enabled {
            self.start();
        } else {
            self.stop();
        }
        Ok(())
    }

    fn serve(&self, mut request: tiny_http::Request) {
        let header = |name: &str| {
            request
                .headers()
                .iter()
                .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
                .map(|h| h.value.as_str().to_string())
        };
        let origin = header("Origin");
        let authorization = header("Authorization");
        let method = request.method().as_str().to_string();
        let path = request.url().split('?').next().unwrap_or("").to_string();
        let too_big = request.body_length().is_some_and(|n| n > MAX_BODY);
        let mut body = Vec::new();
        let result = if too_big {
            error(413, "clip too large")
        } else {
            match request
                .as_reader()
                .take(MAX_BODY as u64 + 1)
                .read_to_end(&mut body)
            {
                Ok(_) if body.len() > MAX_BODY => error(413, "clip too large"),
                Ok(_) => self.handle(&Req {
                    method: &method,
                    path: &path,
                    origin: origin.as_deref(),
                    authorization: authorization.as_deref(),
                    body: &body,
                }),
                Err(_) => error(400, "couldn't read the request"),
            }
        };
        let response = tiny_http::Response::from_string(result.body.to_string())
            .with_status_code(result.status)
            .with_header(
                "Content-Type: application/json"
                    .parse::<tiny_http::Header>()
                    .unwrap(),
            );
        let _ = request.respond(response);
    }
}

#[cfg(test)]
mod tests;
