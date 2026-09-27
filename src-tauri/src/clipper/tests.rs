use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

use super::*;

struct Env {
    _dir: tempfile::TempDir,
    vault: Vault,
    clipper: Arc<Clipper>,
    clips: Arc<Mutex<Vec<(String, String)>>>,
    vault_open: Arc<Mutex<bool>>,
}

fn env() -> Env {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("vault")).unwrap();
    let vault = Vault::open(&dir.path().join("vault")).unwrap();
    let clips = Arc::new(Mutex::new(Vec::new()));
    let open = Arc::new(Mutex::new(true));
    let (v, c, o) = (vault.clone(), clips.clone(), open.clone());
    let clipper = Arc::new(Clipper::new(
        dir.path().join("config/clipper.json"),
        move || o.lock().unwrap().then(|| v.clone()),
        move |path, title| c.lock().unwrap().push((path.into(), title.into())),
    ));
    Env {
        _dir: dir,
        vault,
        clipper,
        clips,
        vault_open: open,
    }
}

fn post<'a>(path: &'a str, auth: Option<&'a str>, body: &'a [u8]) -> Req<'a> {
    Req {
        method: "POST",
        path,
        origin: Some("chrome-extension://abcdef"),
        authorization: auth,
        body,
    }
}

fn pair(e: &Env) -> String {
    let code = e.clipper.start_pairing().code;
    let r = e.clipper.handle(&post(
        "/v1/pair",
        None,
        format!(r#"{{"code":"{code}","name":"Chrome on laptop"}}"#).as_bytes(),
    ));
    assert_eq!(r.status, 200, "{:?}", r.body);
    format!("Bearer {}", r.body["token"].as_str().unwrap())
}

#[test]
fn pairs_with_a_one_time_code_and_stores_only_a_hash() {
    let e = env();
    let auth = pair(&e);
    let status = e.clipper.status();
    assert_eq!(status.devices.len(), 1);
    assert_eq!(status.devices[0].name, "Chrome on laptop");
    let saved = std::fs::read_to_string(&e.clipper.config_path).unwrap();
    let token = auth.strip_prefix("Bearer ").unwrap();
    assert!(!saved.contains(token), "token stored in plain text");
    assert!(saved.contains(&sha256_hex(token)));
    // The code is single-use.
    let again = e
        .clipper
        .handle(&post("/v1/pair", None, br#"{"code":"000000"}"#));
    assert_eq!(again.status, 403);
}

#[test]
fn wrong_codes_are_limited() {
    let e = env();
    let code = e.clipper.start_pairing().code;
    let wrong = if code == "111111" { "222222" } else { "111111" };
    for i in 1..=MAX_PAIRING_ATTEMPTS {
        let r = e.clipper.handle(&post(
            "/v1/pair",
            None,
            format!(r#"{{"code":"{wrong}"}}"#).as_bytes(),
        ));
        assert_eq!(r.status, if i < MAX_PAIRING_ATTEMPTS { 403 } else { 429 });
    }
    // Even the right code no longer works.
    let r = e.clipper.handle(&post(
        "/v1/pair",
        None,
        format!(r#"{{"code":"{code}"}}"#).as_bytes(),
    ));
    assert_eq!(r.status, 403);
}

#[test]
fn refuses_web_pages_and_unpaired_clients() {
    let e = env();
    let auth = pair(&e);
    let mut req = post(
        "/v1/clip",
        Some(&auth),
        br#"{"kind":"url","url":"https://x.io"}"#,
    );
    req.origin = Some("https://evil.example");
    assert_eq!(e.clipper.handle(&req).status, 403);
    let code = e.clipper.start_pairing().code;
    let mut pairing = post("/v1/pair", None, br#"{}"#);
    let body = format!(r#"{{"code":"{code}"}}"#);
    pairing.body = body.as_bytes();
    pairing.origin = Some("http://localhost:3000");
    assert_eq!(e.clipper.handle(&pairing).status, 403);

    let r = e.clipper.handle(&post(
        "/v1/clip",
        Some("Bearer 0123456789abcdef0123456789abcdef"),
        br#"{"kind":"url","url":"https://x.io"}"#,
    ));
    assert_eq!(r.status, 401);
    assert!(e.clips.lock().unwrap().is_empty());
}

#[test]
fn saves_a_page_as_a_note_with_frontmatter() {
    let e = env();
    let auth = pair(&e);
    let body = br#"{"id":"c1","kind":"page","title":"How Cells Work: A Guide","url":"https://bio.example/cells","markdown":"Cells are *small*.\n\n## Parts\n- nucleus","createdMs":1790496000000,"tags":["biology"]}"#;
    let r = e.clipper.handle(&post("/v1/clip", Some(&auth), body));
    assert_eq!(r.status, 201, "{:?}", r.body);
    assert_eq!(r.body["path"], "Clippings/How Cells Work A Guide.md");
    let note = e
        .vault
        .read_file("Clippings/How Cells Work A Guide.md")
        .unwrap()
        .content;
    assert_eq!(
        note,
        "---\nsource: \"https://bio.example/cells\"\nclipped: 2026-09-27 08:00 UTC\nclip: page\ntags: [\"clipping\", \"biology\"]\n---\n# How Cells Work: A Guide\n\nSource: [How Cells Work: A Guide](https://bio.example/cells)\n\nCells are *small*.\n\n## Parts\n- nucleus\n"
    );
    assert_eq!(
        e.clips.lock().unwrap()[0],
        (
            "Clippings/How Cells Work A Guide.md".into(),
            "How Cells Work: A Guide".into()
        )
    );
    // A retried delivery of the same clip is not saved twice; a new clip with the
    // same title gets its own file.
    let r = e.clipper.handle(&post("/v1/clip", Some(&auth), body));
    assert_eq!((r.status, &r.body["duplicate"]), (200, &json!(true)));
    let other = br#"{"id":"c2","kind":"url","title":"How Cells Work: A Guide","url":"https://bio.example/cells"}"#;
    let r = e.clipper.handle(&post("/v1/clip", Some(&auth), other));
    assert_eq!(r.body["path"], "Clippings/How Cells Work A Guide 2.md");
    assert!(e.clipper.status().devices[0].last_used_ms.is_some());
}

#[test]
fn saves_selections_and_screenshots() {
    let e = env();
    let auth = pair(&e);
    let r = e.clipper.handle(&post(
        "/v1/clip",
        Some(&auth),
        br#"{"kind":"selection","title":"Quote","url":"https://a.example/p","markdown":"Line one\n\nLine two"}"#,
    ));
    assert_eq!(r.status, 201);
    let note = e.vault.read_file("Clippings/Quote.md").unwrap().content;
    assert!(
        note.ends_with("# Quote\n\n> Line one\n>\n> Line two\n\n— [Quote](https://a.example/p)\n")
    );

    let png = base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G']);
    let body = format!(
        r#"{{"kind":"screenshot","title":"Chart","url":"https://a.example","image":"data:image/png;base64,{png}","createdMs":1790496000000}}"#
    );
    let r = e
        .clipper
        .handle(&post("/v1/clip", Some(&auth), body.as_bytes()));
    assert_eq!(r.status, 201, "{:?}", r.body);
    let note = e.vault.read_file("Clippings/Chart.md").unwrap().content;
    assert!(note.contains("![[Chart 2026-09-27 08.00.png]]"), "{note}");
    let bytes = std::fs::read(
        e.vault
            .resolve("Clippings/attachments/Chart 2026-09-27 08.00.png")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(bytes, [0x89, b'P', b'N', b'G']);
}

#[test]
fn asks_the_extension_to_retry_when_no_vault_is_open() {
    let e = env();
    let auth = pair(&e);
    *e.vault_open.lock().unwrap() = false;
    let r = e.clipper.handle(&post(
        "/v1/clip",
        Some(&auth),
        br#"{"kind":"url","url":"https://x.io"}"#,
    ));
    assert_eq!(r.status, 503);
    let status = e.clipper.handle(&Req {
        method: "GET",
        path: "/v1/status",
        origin: None,
        authorization: Some(&auth),
        body: b"",
    });
    assert_eq!(status.body["vault"], false);
    assert_eq!(status.body["paired"], true);
}

#[test]
fn rejects_bad_clips_and_folders() {
    let e = env();
    let auth = pair(&e);
    for body in [
        &br#"{"kind":"page","markdown":"  "}"#[..],
        br#"{"kind":"screenshot"}"#,
        br#"{"kind":"video"}"#,
        br#"not json"#,
    ] {
        assert_eq!(
            e.clipper
                .handle(&post("/v1/clip", Some(&auth), body))
                .status,
            400
        );
    }
    assert!(e.clipper.set_folder("../outside").is_err());
    assert!(e.clipper.set_folder(".axis").is_err());
    e.clipper.set_folder("Inbox/Web").unwrap();
    let r = e.clipper.handle(&post(
        "/v1/clip",
        Some(&auth),
        br#"{"kind":"url","title":"T","url":"https://x.io"}"#,
    ));
    assert_eq!(r.body["path"], "Inbox/Web/T.md");
}

#[test]
fn file_names_and_dates() {
    assert_eq!(render::safe_name("  a/b:c*?\"<>| #^[x] "), "a b c x");
    assert_eq!(render::safe_name("..."), "Clipping");
    assert_eq!(render::safe_name(&"x".repeat(200)).len(), 80);
    assert_eq!(render::utc(0), ("1970-01-01".into(), "00:00".into()));
    assert_eq!(
        render::utc(951_782_400_000),
        ("2000-02-29".into(), "00:00".into())
    );
}

#[test]
fn serves_http_on_localhost() {
    let e = env();
    let auth = pair(&e);
    e.clipper.start_on(0);
    let port = e.clipper.port();
    assert!(e.clipper.status().running);
    let send = |raw: String| {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    };
    let body = r#"{"kind":"url","title":"Over HTTP","url":"https://x.io"}"#;
    let out = send(format!(
        "POST /v1/clip HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ));
    assert!(out.starts_with("HTTP/1.1 201"), "{out}");
    assert!(e.vault.read_file("Clippings/Over HTTP.md").is_ok());
    let out = send(
        "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\nConnection: close\r\n\r\n"
            .into(),
    );
    assert!(out.starts_with("HTTP/1.1 403"), "{out}");
    e.clipper.stop();
    assert!(!e.clipper.status().running);
}
