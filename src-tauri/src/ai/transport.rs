//! HTTP for the AI adapters, behind a trait so tests can replay recorded responses.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use super::{AiError, AiResult, BoxFuture};

#[derive(Debug, Clone, PartialEq)]
pub struct HttpRequest {
    pub method: &'static str,
    pub url: String,
    /// Header values may contain secrets; never log them.
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
}

impl HttpRequest {
    pub fn get(url: String) -> Self {
        HttpRequest {
            method: "GET",
            url,
            headers: Vec::new(),
            body: None,
        }
    }

    pub fn post(url: String, body: serde_json::Value) -> Self {
        HttpRequest {
            method: "POST",
            url,
            headers: Vec::new(),
            body: Some(body),
        }
    }

    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.to_string(), value.into()));
        self
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait Transport: Send + Sync {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, AiResult<HttpResponse>>;

    /// Stream the response body. `on_chunk` returns false to stop reading (cancel).
    /// Non-2xx responses are returned whole (status + body) without streaming.
    fn stream<'a>(
        &'a self,
        req: HttpRequest,
        on_chunk: &'a mut (dyn FnMut(&[u8]) -> bool + Send),
    ) -> BoxFuture<'a, AiResult<HttpResponse>>;
}

/// The real network, via reqwest (rustls, OS certificate store).
///
/// Two clients, chosen per request by [`super::is_local_url`], so a request judged local
/// can only reach this computer:
/// - `local` never follows redirects, ignores system proxies, and resolves names only to
///   loopback addresses (`localhost` and `*.localhost`; IP hosts are loopback already).
/// - `remote` follows redirects only within the same server over https
///   ([`remote_redirects`]).
pub struct ReqwestTransport {
    local: reqwest::Client,
    remote: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> AiResult<Self> {
        // rustls needs a process-wide crypto provider; ignore "already installed".
        let _ = rustls::crypto::ring::default_provider().install_default();
        let base = || {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(120))
                .user_agent(concat!("AXISNotes/", env!("CARGO_PKG_VERSION")))
        };
        let client_error = |e: reqwest::Error| AiError::Unavailable(format!("HTTP client: {e}"));
        let local = base()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .dns_resolver(Arc::new(LoopbackResolver))
            .build()
            .map_err(client_error)?;
        let remote = base()
            .redirect(remote_redirects())
            .build()
            .map_err(client_error)?;
        Ok(Self { local, remote })
    }

    fn build(&self, req: &HttpRequest) -> AiResult<reqwest::RequestBuilder> {
        check_endpoint(&req.url)?;
        let client = if super::is_local_url(&req.url) {
            &self.local
        } else {
            &self.remote
        };
        let method =
            reqwest::Method::from_bytes(req.method.as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut b = client.request(method, &req.url);
        for (k, v) in &req.headers {
            b = b.header(k, v);
        }
        if let Some(body) = &req.body {
            b = b.json(body);
        }
        Ok(b)
    }
}

/// Refuse a request that would send keys and notes unencrypted to another computer. Saving
/// such an endpoint is refused too; this catches one saved by an older version.
fn check_endpoint(url: &str) -> AiResult<()> {
    if super::settings::plaintext_remote(url) {
        return Err(AiError::Unavailable(
            super::settings::PLAIN_HTTP_REMOTE.into(),
        ));
    }
    Ok(())
}

/// Shown when an endpoint answered with a redirect AXISNotes won't follow.
const REDIRECT_REFUSED: &str = "the endpoint redirected to another address, which AXISNotes doesn't follow for AI requests. Set the endpoint to the final address.";

/// Redirects for remote endpoints: at most 5, and only to the same host and port over
/// https. Never to this computer (which would change the request's privacy class) or to
/// another server: some providers send the API key in their own header (`x-api-key`,
/// `x-goog-api-key`), which reqwest only strips from standard auth headers on a cross-host
/// redirect. A stopped redirect comes back as a 3xx response.
fn remote_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let next = attempt.url();
        let same_server = attempt.previous().first().is_some_and(|first| {
            first.host() == next.host()
                && first.port_or_known_default() == next.port_or_known_default()
        });
        if attempt.previous().len() > 5 {
            attempt.error("too many redirects")
        } else if next.scheme() == "https" && same_server && !super::is_local(next) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

/// DNS for the local client: `localhost` and `*.localhost` go to loopback without asking
/// the system resolver; any other name fails.
struct LoopbackResolver;

impl reqwest::dns::Resolve for LoopbackResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let local = super::is_localhost_name(&name.as_str().to_ascii_lowercase());
        Box::pin(async move {
            if !local {
                return Err("only localhost names resolve for a local AI provider".into());
            }
            // Port 0 is replaced by the URL's port. IPv4 first: most local servers
            // (Ollama, LM Studio) listen on 127.0.0.1.
            let addrs: Vec<SocketAddr> = vec![
                (Ipv4Addr::LOCALHOST, 0).into(),
                (Ipv6Addr::LOCALHOST, 0).into(),
            ];
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn redirect_refused(status: u16) -> AiResult<()> {
    if (300..400).contains(&status) {
        return Err(AiError::Unavailable(REDIRECT_REFUSED.into()));
    }
    Ok(())
}

fn network_error(e: reqwest::Error) -> AiError {
    if e.is_builder() {
        // The request couldn't be built: a malformed endpoint, or a key with characters
        // that can't go in a header. Say so instead of reqwest's bare "builder error".
        return AiError::Unavailable(
            "the request couldn't be made: check that the endpoint is a web address \
             (or empty for the default) and paste the API key again"
                .into(),
        );
    }
    // reqwest's Display may include the URL; ours never carry keys in the URL.
    AiError::Unavailable(e.without_url().to_string())
}

impl Transport for ReqwestTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, AiResult<HttpResponse>> {
        Box::pin(async move {
            let res = self.build(&req)?.send().await.map_err(network_error)?;
            let status = res.status().as_u16();
            redirect_refused(status)?;
            let body = res.bytes().await.map_err(network_error)?.to_vec();
            Ok(HttpResponse { status, body })
        })
    }

    fn stream<'a>(
        &'a self,
        req: HttpRequest,
        on_chunk: &'a mut (dyn FnMut(&[u8]) -> bool + Send),
    ) -> BoxFuture<'a, AiResult<HttpResponse>> {
        Box::pin(async move {
            let mut res = self.build(&req)?.send().await.map_err(network_error)?;
            let status = res.status().as_u16();
            redirect_refused(status)?;
            if !(200..300).contains(&status) {
                let body = res.bytes().await.map_err(network_error)?.to_vec();
                return Ok(HttpResponse { status, body });
            }
            while let Some(chunk) = res.chunk().await.map_err(network_error)? {
                if !on_chunk(&chunk) {
                    return Err(AiError::Cancelled);
                }
            }
            Ok(HttpResponse {
                status,
                body: Vec::new(),
            })
        })
    }
}

/// Replays recorded responses in order and records the requests (tests only).
#[cfg(test)]
pub mod fixture {
    use std::sync::Mutex;

    use super::*;

    pub struct Fixture {
        responses: Mutex<Vec<(u16, Vec<u8>)>>,
        pub requests: Mutex<Vec<HttpRequest>>,
    }

    impl Fixture {
        pub fn new(responses: Vec<(u16, &str)>) -> Self {
            Fixture {
                responses: Mutex::new(
                    responses
                        .into_iter()
                        .rev()
                        .map(|(s, b)| (s, b.as_bytes().to_vec()))
                        .collect(),
                ),
                requests: Mutex::new(Vec::new()),
            }
        }

        fn next(&self, req: HttpRequest) -> AiResult<HttpResponse> {
            self.requests.lock().unwrap().push(req);
            let (status, body) = self
                .responses
                .lock()
                .unwrap()
                .pop()
                .ok_or_else(|| AiError::Unavailable("no more recorded responses".into()))?;
            if status == 0 {
                return Err(AiError::Unavailable("connection refused".into()));
            }
            Ok(HttpResponse { status, body })
        }
    }

    impl Transport for Fixture {
        fn send(&self, req: HttpRequest) -> BoxFuture<'_, AiResult<HttpResponse>> {
            Box::pin(async move { self.next(req) })
        }

        fn stream<'a>(
            &'a self,
            req: HttpRequest,
            on_chunk: &'a mut (dyn FnMut(&[u8]) -> bool + Send),
        ) -> BoxFuture<'a, AiResult<HttpResponse>> {
            Box::pin(async move {
                let res = self.next(req)?;
                if !(200..300).contains(&res.status) {
                    return Ok(res);
                }
                // Deliver in small pieces to exercise the incremental parsers.
                for piece in res.body.chunks(7) {
                    if !on_chunk(piece) {
                        return Err(AiError::Cancelled);
                    }
                }
                Ok(HttpResponse {
                    status: res.status,
                    body: Vec::new(),
                })
            })
        }
    }
}

/// The real client against a server on 127.0.0.1 (no outside network needed).
#[cfg(test)]
mod network_tests {
    use std::str::FromStr;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use reqwest::dns::Resolve;

    use super::*;

    /// Answers every request with `status` and `location`, counting requests.
    fn serve(status: u16, location: Option<&'static str>) -> (u16, Arc<AtomicUsize>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut res =
                    tiny_http::Response::from_string("{\"ok\":true}").with_status_code(status);
                if let Some(to) = location {
                    res.add_header(tiny_http::Header::from_bytes("Location", to).unwrap());
                }
                let _ = req.respond(res);
            }
        });
        (port, hits)
    }

    #[tokio::test]
    async fn localhost_names_reach_this_computer() {
        let (port, hits) = serve(200, None);
        let t = ReqwestTransport::new().unwrap();
        for host in ["localhost", "127.0.0.1", "LOCALHOST"] {
            let res = t
                .send(HttpRequest::get(format!("http://{host}:{port}/v1/models")))
                .await
                .unwrap();
            assert_eq!(res.status, 200, "{host}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn local_endpoints_never_follow_redirects() {
        let (port, hits) = serve(307, Some("https://example.com/v1/chat/completions"));
        let t = ReqwestTransport::new().unwrap();
        let url = format!("http://localhost:{port}/v1/chat/completions");
        let err = t
            .send(HttpRequest::post(url.clone(), serde_json::json!({})))
            .await
            .unwrap_err();
        assert_eq!(err, AiError::Unavailable(REDIRECT_REFUSED.into()));
        let mut sink = |_: &[u8]| true;
        let err = t
            .stream(HttpRequest::post(url, serde_json::json!({})), &mut sink)
            .await
            .unwrap_err();
        assert_eq!(err, AiError::Unavailable(REDIRECT_REFUSED.into()));
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn refuses_plain_http_to_other_computers_before_connecting() {
        let t = ReqwestTransport::new().unwrap();
        for url in [
            "http://192.168.1.10:11434/v1/models",
            "http://localhost@evil.example/v1/models",
            "HTTP://evil.example/v1",
        ] {
            let err = t.send(HttpRequest::get(url.into())).await.unwrap_err();
            assert_eq!(
                err,
                AiError::Unavailable(super::super::settings::PLAIN_HTTP_REMOTE.into()),
                "{url}"
            );
        }
    }

    #[tokio::test]
    async fn loopback_resolver_only_resolves_localhost_names() {
        let r = LoopbackResolver;
        let addrs: Vec<SocketAddr> = r
            .resolve(reqwest::dns::Name::from_str("ollama.localhost").unwrap())
            .await
            .unwrap()
            .collect();
        assert!(addrs.iter().all(|a| a.ip().is_loopback()) && !addrs.is_empty());
        for name in ["evil.example", "localhost.evil.example", "localhost."] {
            let res = r.resolve(reqwest::dns::Name::from_str(name).unwrap()).await;
            assert!(res.is_err(), "{name}");
        }
    }
}
