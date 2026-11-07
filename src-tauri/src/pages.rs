//! Web pages from the vault, shown inside the app (T-190).
//!
//! `axispage://localhost/<vault path>` (`http://axispage.localhost/…` on Windows) serves
//! a vault `.html` page and the styles, scripts, images and fonts it links to. The app
//! shows it in a sandboxed `<iframe>` without `allow-same-origin`, so the page runs with an
//! opaque ("null") origin. That matters: Tauri treats every protocol the app registers as
//! part of the app, so a page running *as* `axispage` could call every command. With a
//! null origin, Tauri's IPC refuses its calls ("Origin header is not a valid URL"), the
//! invoke key is only given to the top-level page, and the page can't reach the app's DOM.
//!
//! The response's own Content-Security-Policy repeats the sandbox (so the page stays
//! sandboxed even if something loads it outside the frame) and blocks every network
//! request: pages are self-contained files, like the AI-made quizzes and lessons.

use std::borrow::Cow;

use tauri::http::{header, Request, Response, StatusCode};

use crate::attachments::percent_decode;
use crate::vault::{Vault, IMAGE_EXTENSIONS};

/// The protocol name. Must match `PAGE_PROTOCOL` in `src/ipc/tauriBackend.ts` and the
/// `frame-src` entries in `tauri.conf.json`.
pub const SCHEME: &str = "axispage";

/// The biggest file a page may load.
const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// The page's origin as the webview sees it, for its own `'self'` sources.
const ORIGIN: &str = if cfg!(any(windows, target_os = "android")) {
    "http://axispage.localhost"
} else {
    "axispage://localhost"
};

/// What a page may do. `sandbox` without `allow-same-origin` gives it a null origin, the
/// same as the frame's `sandbox` attribute; nothing may be fetched from the network.
fn page_policy() -> String {
    let own = format!("'self' {ORIGIN}");
    [
        "sandbox allow-scripts allow-forms allow-modals".to_string(),
        "default-src 'none'".to_string(),
        format!("script-src {own} 'unsafe-inline' 'unsafe-eval'"),
        format!("style-src {own} 'unsafe-inline'"),
        format!("img-src {own} data: blob:"),
        format!("font-src {own} data:"),
        format!("media-src {own} data: blob:"),
        "form-action 'none'".to_string(),
        "base-uri 'none'".to_string(),
    ]
    .join("; ")
}

/// The content type for a file a page may load, or `None` for anything else.
fn content_type(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        e if IMAGE_EXTENSIONS.contains(&e) => match e {
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "avif" => "image/avif",
            _ => return None,
        },
        _ => return None,
    })
}

/// The vault path a request asks for: the URL path, unescaped, without its query.
fn requested_path(uri: &tauri::http::Uri) -> String {
    let path = uri.path().trim_start_matches('/');
    percent_decode(path)
}

fn plain(status: StatusCode, text: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(text.as_bytes().to_vec()))
        .unwrap()
}

/// Answer one request from a page, reading from `vault` (the open one, if any).
pub fn respond(vault: Option<&Vault>, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    if request.method() != tauri::http::Method::GET {
        return plain(StatusCode::METHOD_NOT_ALLOWED, "Pages can only read files.");
    }
    let Some(vault) = vault else {
        return plain(StatusCode::NOT_FOUND, "No vault is open.");
    };
    let rel = requested_path(request.uri());
    let Some(kind) = content_type(&rel) else {
        return plain(
            StatusCode::FORBIDDEN,
            "Pages can only load web pages, styles, scripts, images and fonts.",
        );
    };
    let abs = match vault.resolve(&rel) {
        Ok(abs) => abs,
        Err(_) => return plain(StatusCode::FORBIDDEN, "That file is outside the vault."),
    };
    let meta = match std::fs::metadata(&abs) {
        Ok(m) if m.is_file() => m,
        _ => return plain(StatusCode::NOT_FOUND, "File not found."),
    };
    if meta.len() > MAX_BYTES {
        return plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            "That file is too big to show.",
        );
    }
    let bytes = match std::fs::read(&abs) {
        Ok(b) => b,
        Err(_) => return plain(StatusCode::NOT_FOUND, "File not found."),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CONTENT_SECURITY_POLICY, page_policy())
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(bytes))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Bio")).unwrap();
        std::fs::write(dir.path().join("Bio/Quiz page.html"), "<p>Quiz</p>").unwrap();
        std::fs::write(dir.path().join("Bio/cell.png"), [137u8, 80, 78, 71]).unwrap();
        std::fs::write(dir.path().join("Bio/Cells.md"), "# Cells").unwrap();
        std::fs::write(dir.path().join("tool.exe"), "MZ").unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    fn get(v: Option<&Vault>, uri: &str) -> Response<Cow<'static, [u8]>> {
        respond(v, &Request::get(uri).body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_a_page_sandboxed_and_offline() {
        let (_d, v) = vault();
        let r = get(
            Some(&v),
            "http://axispage.localhost/Bio/Quiz%20page.html?r=2",
        );
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(&r.body()[..], b"<p>Quiz</p>");
        assert_eq!(
            r.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        let csp = r.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.starts_with("sandbox allow-scripts allow-forms allow-modals;"));
        assert!(!csp.contains("allow-same-origin"));
        assert!(!csp.contains("allow-popups"));
        assert!(csp.contains("default-src 'none'"));
        assert!(!csp.contains("connect-src"), "no fetch, XHR or WebSocket");
        assert!(!csp.contains("https:") && !csp.contains("http: "));
        assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
    }

    #[test]
    fn serves_files_the_page_links_to() {
        let (_d, v) = vault();
        let r = get(Some(&v), "axispage://localhost/Bio/cell.png");
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "image/png");
    }

    #[test]
    fn refuses_notes_programs_escapes_and_writes() {
        let (_d, v) = vault();
        assert_eq!(
            get(Some(&v), "axispage://localhost/Bio/Cells.md").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            get(Some(&v), "axispage://localhost/tool.exe").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            get(Some(&v), "axispage://localhost/..%2F..%2Fsecret.html").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            get(Some(&v), "axispage://localhost/Bio/Missing.html").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(None, "axispage://localhost/Bio/Quiz%20page.html").status(),
            StatusCode::NOT_FOUND
        );
        let post = Request::post("axispage://localhost/Bio/Quiz%20page.html")
            .body(b"x".to_vec())
            .unwrap();
        assert_eq!(
            respond(Some(&v), &post).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }
}
