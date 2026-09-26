//! The one `AiProvider` implementation: a codec (API format) driven over a transport.
//! If the provider rejects a parameter (models differ, and change often), the adapter
//! drops it and retries once before reporting a clear error.

use std::sync::Arc;

use serde_json::Value;

use super::codec::{codec_for, drop_param, error_from, Codec, Flags, StreamAcc};
use super::registry::Registry;
use super::sse::SseParser;
use super::transport::{HttpResponse, Transport};
use super::{
    AiError, AiProvider, AiResult, BoxFuture, Completion, ModelInfo, ProviderKind, Request,
};

pub struct Adapter {
    pub kind: ProviderKind,
    base_url: String,
    key: Option<String>,
    codec: &'static dyn Codec,
    transport: Arc<dyn Transport>,
    registry: Arc<Registry>,
}

impl Adapter {
    pub fn new(
        kind: ProviderKind,
        base_url: Option<&str>,
        key: Option<String>,
        transport: Arc<dyn Transport>,
        registry: Arc<Registry>,
    ) -> Self {
        let base = base_url
            .filter(|b| !b.trim().is_empty())
            .unwrap_or(kind.default_base_url())
            .trim()
            .to_string();
        Adapter {
            kind,
            base_url: base,
            key: key.filter(|k| !k.is_empty()),
            codec: codec_for(kind.format()),
            transport,
            registry,
        }
    }

    fn prepared(&self, req: &Request) -> Request {
        let mut r = req.clone();
        self.registry.prepare(self.kind, &mut r);
        r
    }

    /// Whether a failed attempt should be retried with a parameter removed.
    fn retry_without(err: &AiError, req: &mut Request, flags: &mut Flags) -> bool {
        match err {
            AiError::Invalid { param: Some(p), .. } => drop_param(p, req, flags),
            _ => false,
        }
    }

    fn json(res: &HttpResponse) -> AiResult<Value> {
        serde_json::from_slice(&res.body)
            .map_err(|e| AiError::Protocol(format!("response is not JSON: {e}")))
    }

    #[allow(dead_code)] // used by `complete`
    async fn complete_once(&self, req: &Request, flags: Flags) -> AiResult<Completion> {
        let http = self
            .codec
            .request(&self.base_url, self.key.as_deref(), req, false, flags);
        let res = self.transport.send(http).await?;
        if !(200..300).contains(&res.status) {
            return Err(error_from(res.status, &res.body));
        }
        let mut c = self.codec.parse(&Self::json(&res)?)?;
        if c.model.is_empty() {
            c.model = req.model.clone();
        }
        Ok(c)
    }

    async fn stream_once(
        &self,
        req: &Request,
        flags: Flags,
        on_delta: &mut (dyn FnMut(&str) -> bool + Send),
        emitted: &mut bool,
    ) -> AiResult<Completion> {
        let http = self
            .codec
            .request(&self.base_url, self.key.as_deref(), req, true, flags);
        let mut parser = SseParser::new();
        let mut acc = StreamAcc::default();
        let mut failure: Option<AiError> = None;
        let codec = self.codec;
        let mut on_chunk = |chunk: &[u8]| -> bool {
            for ev in parser.push(chunk) {
                match codec.event(&ev, &mut acc) {
                    Ok(Some(delta)) if !delta.is_empty() => {
                        *emitted = true;
                        if !on_delta(&delta) {
                            failure = Some(AiError::Cancelled);
                            return false;
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        failure = Some(e);
                        return false;
                    }
                }
            }
            true
        };
        let res = self.transport.stream(http, &mut on_chunk).await;
        if let Some(e) = failure {
            return Err(e);
        }
        let res = res?;
        if !(200..300).contains(&res.status) {
            return Err(error_from(res.status, &res.body));
        }
        for ev in parser.finish() {
            if let Some(delta) = codec.event(&ev, &mut acc)? {
                if !delta.is_empty() {
                    *emitted = true;
                    if !on_delta(&delta) {
                        return Err(AiError::Cancelled);
                    }
                }
            }
        }
        Ok(acc.into_completion(&req.model))
    }
}

impl AiProvider for Adapter {
    fn complete<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, AiResult<Completion>> {
        Box::pin(async move {
            let mut r = self.prepared(req);
            let mut flags = Flags::default();
            match self.complete_once(&r, flags).await {
                Err(e) if Self::retry_without(&e, &mut r, &mut flags) => {
                    self.complete_once(&r, flags).await
                }
                other => other,
            }
        })
    }

    fn stream<'a>(
        &'a self,
        req: &'a Request,
        on_delta: &'a mut (dyn FnMut(&str) -> bool + Send),
    ) -> BoxFuture<'a, AiResult<Completion>> {
        Box::pin(async move {
            let mut r = self.prepared(req);
            let mut flags = Flags::default();
            let mut emitted = false;
            match self.stream_once(&r, flags, on_delta, &mut emitted).await {
                // Only retry if nothing reached the caller yet.
                Err(e) if !emitted && Self::retry_without(&e, &mut r, &mut flags) => {
                    self.stream_once(&r, flags, on_delta, &mut emitted).await
                }
                other => other,
            }
        })
    }

    fn list_models(&self) -> BoxFuture<'_, AiResult<Vec<ModelInfo>>> {
        Box::pin(async move {
            let http = self
                .codec
                .models_request(&self.base_url, self.key.as_deref());
            let res = self.transport.send(http).await?;
            if !(200..300).contains(&res.status) {
                return Err(error_from(res.status, &res.body));
            }
            let models = self.codec.parse_models(&Self::json(&res)?);
            Ok(models
                .into_iter()
                .filter(|m| self.registry.is_text_model(self.kind, &m.id))
                .map(|m| self.registry.enrich(self.kind, m))
                .collect())
        })
    }
}
