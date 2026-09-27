use super::*;

fn write(root: &Path, rel: &str, content: &[u8]) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, content).unwrap();
}

struct Env {
    _dir: tempfile::TempDir,
    source: PathBuf,
    vault: Vault,
}

fn env() -> Env {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("Obsidian Vault");
    write(&source, ".obsidian/app.json", b"{}");
    write(
        &source,
        ".obsidian/templates.json",
        br#"{"folder":"Templates"}"#,
    );
    write(
        &source,
        ".obsidian/daily-notes.json",
        br#"{"folder":"Journal/","format":"YYYY-MM-DD","template":"Templates/Daily"}"#,
    );
    write(&source, ".trash/old.md", b"deleted");
    write(
        &source,
        "Home.md",
        b"---\ntags: [start]\n---\n# Home\n\nSee [[Projects/Alpha|Alpha]] and ![[diagram.png]].\n> [!note]\n> A callout ^b1\n",
    );
    write(&source, "Projects/Alpha.md", b"# Alpha\n#work/alpha\n");
    write(&source, "Templates/Daily.md", b"# {{date}}\n");
    write(
        &source,
        "attachments/diagram.png",
        &[0x89, b'P', b'N', b'G'],
    );
    write(
        &source,
        "Board.canvas",
        br#"{"nodes":[
            {"id":"a","type":"file","file":"Projects/Alpha.md","x":0,"y":0,"width":300,"height":200},
            {"id":"b","type":"text","text":"Idea","x":400,"y":0,"width":200,"height":60},
            {"id":"g","type":"group","label":"Q3","x":-20,"y":-40,"width":700,"height":300},
            {"id":"l","type":"link","url":"https://obsidian.md","x":0,"y":300,"width":250,"height":60}
          ],"edges":[{"id":"e1","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","label":"leads to"}]}"#,
    );
    let vault_dir = dir.path().join("AXIS Vault");
    fs::create_dir_all(&vault_dir).unwrap();
    let vault = Vault::open(&vault_dir).unwrap();
    Env {
        _dir: dir,
        source,
        vault,
    }
}

#[test]
fn imports_notes_attachments_and_canvases_into_a_folder() {
    let e = env();
    assert!(is_obsidian_vault(&e.source));
    let r = import_obsidian(&e.vault, &e.source, "Obsidian/").unwrap();
    assert_eq!((r.notes, r.attachments, r.canvases), (3, 1, 1), "{r:?}");
    assert!(r.skipped.is_empty(), "{:?}", r.skipped);
    assert_eq!(r.target, "Obsidian");
    // Notes are copied byte for byte (Obsidian Markdown is AXIS Markdown).
    assert_eq!(
        e.vault.read_file("Obsidian/Home.md").unwrap().content,
        fs::read_to_string(e.source.join("Home.md")).unwrap()
    );
    assert_eq!(
        fs::read(e.vault.resolve("Obsidian/attachments/diagram.png").unwrap()).unwrap(),
        [0x89, b'P', b'N', b'G']
    );
    // Obsidian's own folders are left out.
    assert!(!e.vault.resolve("Obsidian/.obsidian").unwrap().exists());
    assert!(!e.vault.resolve("Obsidian/.trash").unwrap().exists());
    assert_eq!(
        r.settings,
        ObsidianSettings {
            templates_folder: Some("Obsidian/Templates".into()),
            daily_folder: Some("Obsidian/Journal".into()),
            daily_format: Some("YYYY-MM-DD".into()),
            daily_template: Some("Obsidian/Templates/Daily.md".into()),
        }
    );
}

#[test]
fn converts_json_canvas_to_an_axis_canvas() {
    let e = env();
    import_obsidian(&e.vault, &e.source, "Obsidian").unwrap();
    let text = e
        .vault
        .read_file("Obsidian/Board.axcanvas")
        .unwrap()
        .content;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["type"], "excalidraw");
    let els = v["elements"].as_array().unwrap();
    let find = |id: &str| els.iter().find(|x| x["id"] == id).unwrap();
    assert_eq!(find("jc-a")["type"], "embeddable");
    assert_eq!(find("jc-a")["link"], "axis:Obsidian/Projects/Alpha.md");
    assert_eq!(find("jc-b")["text"], "Idea");
    assert_eq!(find("jc-g")["strokeStyle"], "dashed");
    assert_eq!(find("jc-g-label")["text"], "Q3");
    assert_eq!(find("jc-l")["link"], "https://obsidian.md");
    let arrow = find("jc-e1");
    assert_eq!(arrow["type"], "arrow");
    // From the right side of the card (300, 100) to the left side of the text (400, 30).
    assert_eq!(
        (arrow["x"].as_f64(), arrow["y"].as_f64()),
        (Some(300.0), Some(100.0))
    );
    assert_eq!(arrow["points"][1], serde_json::json!([100.0, -70.0]));
    assert_eq!(find("jc-e1-label")["text"], "leads to");
    assert!(json_canvas_to_axcanvas("not json", "").is_err());
}

#[test]
fn never_overwrites_and_refuses_to_import_itself() {
    let e = env();
    e.vault.write_file("Home.md", "mine", None).unwrap();
    let r = import_obsidian(&e.vault, &e.source, "").unwrap();
    assert_eq!(e.vault.read_file("Home.md").unwrap().content, "mine");
    assert_eq!(
        r.skipped,
        vec![Skipped {
            path: "Home.md".into(),
            reason: "already exists in the vault".into()
        }]
    );
    assert_eq!(r.notes, 2);
    // Importing again skips everything.
    let again = import_obsidian(&e.vault, &e.source, "").unwrap();
    assert_eq!(again.notes + again.attachments + again.canvases, 0);

    assert!(import_obsidian(&e.vault, e.vault.root(), "x").is_err());
    let inner = e.vault.root().join("sub");
    fs::create_dir_all(&inner).unwrap();
    assert!(import_obsidian(&e.vault, &inner, "x").is_err());
    assert!(import_obsidian(&e.vault, &e.source, "../escape").is_err());
    assert!(import_obsidian(&e.vault, &e.source, ".axis").is_err());
}
