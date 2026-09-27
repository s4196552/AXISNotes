//! HTTP for the AI adapters, behind a trait so tests can replay recorded responses.

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
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> AiResult<Self> {
        // rustls needs a process-wide crypto provider; ignore "already installed".
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(120))
            .user_agent(concat!("AXISNotes/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| AiError::Unavailable(format!("HTTP client: {e}")))?;
        Ok(Self { client })
    }

    fn build(&self, req: &HttpRequest) -> reqwest::RequestBuilder {
        let method =
            reqwest::Method::from_bytes(req.method.as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut b = self.client.request(method, &req.url);
        for (k, v) in &req.headers {
            b = b.header(k, v);
        }
        if let Some(body) = &req.body {
            b = b.json(body);
        }
        b
    }
}

fn network_error(e: reqwest::Error) -> AiError {
    // reqwest's Display may include the URL; ours never carry keys in the URL.
    AiError::Unavailable(e.without_url().to_string())
}

impl Transport for ReqwestTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, AiResult<HttpResponse>> {
        Box::pin(async move {
            let res = self.build(&req).send().await.map_err(network_error)?;
            let status = res.status().as_u16();
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
            let mut res = self.build(&req).send().await.map_err(network_error)?;
            let status = res.status().as_u16();
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
