use std::io::Write as _;

use base64::Engine;

use super::*;

fn write(root: &Path, rel: &str, content: &[u8]) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, content).unwrap();
}

fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        zip.start_file(*name, opts).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}

struct Env {
    dir: tempfile::TempDir,
    source: PathBuf,
    vault: Vault,
}

fn vault_in(dir: &tempfile::TempDir) -> Vault {
    let vault_dir = dir.path().join("AXIS Vault");
    fs::create_dir_all(&vault_dir).unwrap();
    Vault::open(&vault_dir).unwrap()
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
    let vault = vault_in(&dir);
    Env { dir, source, vault }
}

fn import(e: &Env, kind: ImportKind, source: &Path, target: &str) -> ImportReport {
    run(
        &e.vault,
        kind,
        source,
        target,
        ImportOptions::default(),
        &mut |_, _| {},
    )
    .unwrap()
}

fn read(e: &Env, path: &str) -> String {
    e.vault.read_file(path).unwrap().content
}

// ---- Obsidian ----

#[test]
fn imports_notes_attachments_and_canvases_into_a_folder() {
    let e = env();
    let p = inspect(ImportKind::Obsidian, &e.source).unwrap();
    assert_eq!((p.notes, p.attachments, p.canvases), (3, 1, 1), "{p:?}");
    assert_eq!(p.looks_like, None);
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);

    let mut calls = Vec::new();
    let r = run(
        &e.vault,
        ImportKind::Obsidian,
        &e.source,
        "Obsidian/",
        ImportOptions::default(),
        &mut |done, total| calls.push((done, total)),
    )
    .unwrap();
    assert_eq!((r.notes, r.attachments, r.canvases), (3, 1, 1), "{r:?}");
    assert_eq!(calls.first(), Some(&(0, 5)));
    assert_eq!(calls.last(), Some(&(5, 5)));
    assert!(r.skipped.is_empty(), "{:?}", r.skipped);
    assert_eq!(r.target, "Obsidian");
    // Notes are copied byte for byte (Obsidian Markdown is AXIS Markdown).
    assert_eq!(
        read(&e, "Obsidian/Home.md"),
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
    import(&e, ImportKind::Obsidian, &e.source, "Obsidian");
    let v: serde_json::Value = serde_json::from_str(&read(&e, "Obsidian/Board.axcanvas")).unwrap();
    assert_eq!(v["type"], "excalidraw");
    let els = v["elements"].as_array().unwrap();
    let find = |id: &str| els.iter().find(|x| x["id"] == id).unwrap();
    assert_eq!(find("jc-a")["type"], "embeddable");
    assert_eq!(find("jc-a")["link"], "axis:Obsidian/Projects/Alpha.md");
    assert_eq!(find("jc-b")["type"], "rectangle");
    assert_eq!(find("jc-b-t")["text"], "Idea");
    assert_eq!(find("jc-b-t")["containerId"], "jc-b");
    assert_eq!(find("jc-b")["boundElements"][0]["id"], "jc-b-t");
    assert_eq!(find("jc-g")["strokeStyle"], "dashed");
    assert_eq!(find("jc-g-label")["text"], "Q3");
    assert_eq!(find("jc-l")["link"], "https://obsidian.md");
    let arrow = find("jc-e1");
    let bound_to = |id: &str| {
        find(id)["boundElements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["id"] == "jc-e1")
    };
    assert_eq!(arrow["startBinding"]["elementId"], "jc-a");
    assert!(bound_to("jc-a") && bound_to(arrow["endBinding"]["elementId"].as_str().unwrap()));
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
fn imports_into_a_new_folder_and_never_overwrites() {
    let e = env();
    e.vault.write_file("Old/Home.md", "mine", None).unwrap();
    let r = import(&e, ImportKind::Obsidian, &e.source, "Old");
    // "Old" exists: the import gets a folder of its own.
    assert_eq!(r.target, "Old 2");
    assert_eq!(read(&e, "Old/Home.md"), "mine");
    assert!(read(&e, "Old 2/Home.md").contains("# Home"));
    let again = import(&e, ImportKind::Obsidian, &e.source, "Old");
    assert_eq!(again.target, "Old 3");
    assert_eq!(again.notes, 3);

    let fails = |source: &Path, target: &str| {
        run(
            &e.vault,
            ImportKind::Obsidian,
            source,
            target,
            ImportOptions::default(),
            &mut |_, _| {},
        )
        .is_err()
    };
    assert!(fails(e.vault.root(), "x"));
    let inner = e.vault.root().join("sub");
    fs::create_dir_all(&inner).unwrap();
    assert!(fails(&inner, "x"));
    assert!(fails(&e.source, "../escape"));
    assert!(fails(&e.source, ".axisnotes"));
    assert!(fails(&e.source, ""));
    assert!(fails(&e.dir.path().join("missing"), "x"));
}

#[test]
fn notices_a_folder_that_isnt_what_was_chosen() {
    let e = env();
    let p = inspect(ImportKind::Notion, &e.source).unwrap();
    assert_eq!(p.looks_like, Some(ImportKind::Obsidian));
    assert!(p.warnings.iter().any(|w| w.contains("Notion page IDs")));
    // Any Markdown folder imports as Markdown, Obsidian vaults too.
    assert_eq!(
        inspect(ImportKind::Markdown, &e.source).unwrap().looks_like,
        None
    );
}

// ---- Notion ----

const HOME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const TASKS: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
const ROW: &str = "ccccccccccccccccccccccccccccccc3";
const UNTITLED_1: &str = "ddddddddddddddddddddddddddddddd4";
const UNTITLED_2: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5";

/// A small "Markdown & CSV" export: a page with a subpage, an image, a database (view and
/// full table) with a row page, and two untitled pages.
fn notion_entries() -> Vec<(String, Vec<u8>)> {
    let home = format!(
        "# Home\n\nSee [Tasks](Home%20{HOME}/Tasks%20{TASKS}.csv) and [Plan](Home%20{HOME}/Plan%20{ROW}.md).\n\n\
         ![Diagram](Home%20{HOME}/diagram%201.png)\n\n[Elsewhere](https://www.notion.so/team/Plan-{ROW}?pvs=4)\n\
         [Missing](Home%20{HOME}/Gone%2000000000000000000000000000000f.md)\n"
    );
    vec![
        (format!("Home {HOME}.md"), home.into_bytes()),
        (
            format!("Home {HOME}/Plan {ROW}.md"),
            format!("# Plan\n\nBack to [Home](../Home%20{HOME}.md)\n").into_bytes(),
        ),
        (format!("Home {HOME}/diagram 1.png"), b"\x89PNG".to_vec()),
        (
            format!("Home {HOME}/Tasks {TASKS}.csv"),
            b"Name,Status\nWrite,Done\n".to_vec(),
        ),
        (
            format!("Home {HOME}/Tasks {TASKS}_all.csv"),
            "\u{feff}Name,Status,Tags\nWrite,Done,\"work, urgent\"\nRead,Todo,\n"
                .as_bytes()
                .to_vec(),
        ),
        (
            format!("Home {HOME}/Tasks {TASKS}/Write {ROW}.md"),
            b"# Write\n\nStatus: Done\nTags: work, urgent\n\nDraft the essay.\n".to_vec(),
        ),
        (
            format!("Home {HOME}/Untitled {UNTITLED_1}.md"),
            b"# Untitled\n\nOne\n".to_vec(),
        ),
        (
            format!("Home {HOME}/Untitled {UNTITLED_2}.md"),
            b"# Untitled\n\nTwo\n".to_vec(),
        ),
    ]
}

fn notion_zip(dir: &Path, parts: bool) -> PathBuf {
    let entries = notion_entries();
    let refs: Vec<(&str, &[u8])> = entries
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    let path = dir.join("Export-1234.zip");
    if !parts {
        make_zip(&path, &refs);
        return path;
    }
    // Big exports: a zip of zips, each holding part of the export.
    let (a, b) = refs.split_at(3);
    let p1 = dir.join("p1.zip");
    let p2 = dir.join("p2.zip");
    make_zip(&p1, a);
    make_zip(&p2, b);
    let (b1, b2) = (fs::read(&p1).unwrap(), fs::read(&p2).unwrap());
    make_zip(
        &path,
        &[
            ("Export-1234-Part-1.zip", b1.as_slice()),
            ("Export-1234-Part-2.zip", b2.as_slice()),
        ],
    );
    path
}

fn check_notion_import(e: &Env, r: &ImportReport) {
    let t = "Imported/Notion";
    assert_eq!(r.target, t);
    assert_eq!((r.notes, r.attachments, r.tables), (5, 1, 1), "{r:?}");
    assert_eq!(
        r.skipped,
        vec![Skipped {
            path: format!("Home {HOME}/Tasks {TASKS}.csv"),
            reason: "a view of a database; its full table was imported".into()
        }]
    );
    assert!(
        r.warnings.iter().any(|w| w.starts_with("1 link to pages")),
        "{:?}",
        r.warnings
    );
    // IDs gone from names; name clashes resolved; links rewritten; the `# Title` that only
    // repeats the page's name dropped.
    assert_eq!(
        read(e, &format!("{t}/Home.md")),
        format!(
            "See [[{t}/Home/Tasks.axgrid|Tasks]] and [[{t}/Home/Plan|Plan]].\n\n\
             ![Diagram](Home/diagram%201.png)\n\n[[{t}/Home/Plan|Elsewhere]]\n\
             [Missing](Home%20{HOME}/Gone%2000000000000000000000000000000f.md)\n"
        )
    );
    assert_eq!(
        read(e, &format!("{t}/Home/Plan.md")),
        format!("Back to [[{t}/Home|Home]]\n")
    );
    assert!(read(e, &format!("{t}/Home/Untitled.md")).contains("One"));
    assert!(read(e, &format!("{t}/Home/Untitled 2.md")).contains("Two"));
    assert!(e
        .vault
        .resolve(&format!("{t}/Home/diagram 1.png"))
        .unwrap()
        .exists());
    // The database's full table is a grid; its row's properties are frontmatter.
    let grid: serde_json::Value =
        serde_json::from_str(&read(e, &format!("{t}/Home/Tasks.axgrid"))).unwrap();
    assert_eq!(grid["cells"]["C1"], "Tags");
    assert_eq!(grid["cells"]["A3"], "Read");
    assert_eq!(
        read(e, &format!("{t}/Home/Tasks/Write.md")),
        "---\nStatus: \"Done\"\nTags:\n  - \"work\"\n  - \"urgent\"\n---\nDraft the essay.\n"
    );
    // A first heading that isn't the page's name stays.
    assert_eq!(drop_title_heading("# Other\n\nx", "Plan"), "# Other\n\nx");
}

#[test]
fn imports_a_notion_zip() {
    let e = env();
    let zip = notion_zip(e.dir.path(), false);
    let p = inspect(ImportKind::Notion, &zip).unwrap();
    assert_eq!(p.name, "Export-1234");
    assert_eq!((p.notes, p.attachments, p.tables), (5, 1, 1), "{p:?}");
    assert!(p.warnings.is_empty() && p.looks_like.is_none(), "{p:?}");
    assert_eq!(
        inspect(ImportKind::Markdown, &zip).unwrap().looks_like,
        Some(ImportKind::Notion)
    );
    let r = import(&e, ImportKind::Notion, &zip, "Imported/Notion");
    check_notion_import(&e, &r);
    assert_eq!(r.links, 5);
}

#[test]
fn imports_a_multi_part_notion_zip_and_an_unzipped_export() {
    let e = env();
    let zip = notion_zip(e.dir.path(), true);
    check_notion_import(&e, &import(&e, ImportKind::Notion, &zip, "Imported/Notion"));

    let e = env();
    let folder = e.dir.path().join("Unzipped");
    for (name, bytes) in notion_entries() {
        write(&folder, &name, &bytes);
    }
    check_notion_import(
        &e,
        &import(&e, ImportKind::Notion, &folder, "Imported/Notion"),
    );
}

#[test]
fn notion_databases_can_be_markdown_tables() {
    let e = env();
    let zip = notion_zip(e.dir.path(), false);
    let r = run(
        &e.vault,
        ImportKind::Notion,
        &zip,
        "N",
        ImportOptions {
            tables_as_markdown: true,
        },
        &mut |_, _| {},
    )
    .unwrap();
    assert_eq!(r.tables, 1);
    assert_eq!(
        read(&e, "N/Home/Tasks.md"),
        "# Tasks\n\n| Name | Status | Tags |\n| --- | --- | --- |\n| [[N/Home/Tasks/Write]] | Done | work, urgent |\n| Read | Todo |  |\n"
    );
    assert!(read(&e, "N/Home.md").contains("[[N/Home/Tasks|Tasks]]"));
}

// ---- Markdown ----

#[test]
fn imports_a_markdown_zip_with_html_and_relative_links() {
    let e = env();
    let zip = e.dir.path().join("Bear Export.zip");
    make_zip(
        &zip,
        &[
            (
                "Bear Export/Recipes.md",
                b"# Recipes\n\n[Soup](Soups/Tomato%20soup.md) ![](Recipes/photo.jpg)\n[[Logseq style]]\n",
            ),
            ("Bear Export/Soups/Tomato soup.txt", b"Simmer.\n"),
            ("Bear Export/Soups/Tomato soup.md", b"# Tomato soup\n\n[Back](../Recipes.md)\n"),
            ("Bear Export/Recipes/photo.jpg", b"jpeg"),
            (
                "Bear Export/Page.html",
                b"<html><head><title>Page</title></head><body><h1>Page</h1><p>See <a href=\"Recipes.md\">recipes</a>.</p></body></html>",
            ),
            ("Bear Export/What?.md", b"odd name"),
            ("__MACOSX/Bear Export/._Recipes.md", b"junk"),
        ],
    );
    let p = inspect(ImportKind::Markdown, &zip).unwrap();
    assert_eq!((p.notes, p.attachments), (5, 1), "{p:?}");
    let r = import(&e, ImportKind::Markdown, &zip, "Imported/Bear");
    assert_eq!((r.notes, r.attachments), (5, 1), "{r:?}");
    assert!(r.skipped.is_empty(), "{:?}", r.skipped);
    // The zip's one top folder is unwrapped.
    assert_eq!(
        read(&e, "Imported/Bear/Recipes.md"),
        "# Recipes\n\n[[Imported/Bear/Soups/Tomato soup|Soup]] ![](Recipes/photo.jpg)\n[[Logseq style]]\n"
    );
    // `Tomato soup.txt` and `Tomato soup.md` would both be `Tomato soup.md`.
    assert_eq!(
        read(&e, "Imported/Bear/Soups/Tomato soup.md"),
        "# Tomato soup\n\n[[Imported/Bear/Recipes|Back]]\n"
    );
    assert_eq!(
        read(&e, "Imported/Bear/Soups/Tomato soup 2.md"),
        "Simmer.\n"
    );
    assert_eq!(
        read(&e, "Imported/Bear/Page.md"),
        "# Page\n\nSee [[Imported/Bear/Recipes|recipes]].\n"
    );
    assert_eq!(read(&e, "Imported/Bear/What-.md"), "odd name");
}

#[test]
fn leaves_logseq_settings_out() {
    let e = env();
    let src = e.dir.path().join("graph");
    write(&src, "logseq/config.edn", b"{}");
    write(&src, "logseq/bak/pages/x.md", b"old");
    write(&src, "pages/Topic.md", b"- [[Other]]\n");
    write(&src, "journals/2026_10_20.md", b"- today\n");
    let r = import(&e, ImportKind::Markdown, &src, "Logseq");
    assert_eq!((r.notes, r.attachments), (2, 0), "{r:?}");
    assert!(!e.vault.resolve("Logseq/logseq").unwrap().exists());
    assert_eq!(read(&e, "Logseq/pages/Topic.md"), "- [[Other]]\n");
}

// ---- Evernote ----

fn enex(notes: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE en-export SYSTEM \"http://xml.evernote.com/pub/evernote-export4.dtd\">\n<en-export>{notes}</en-export>"
    )
}

#[test]
fn imports_evernote_notebooks() {
    let e = env();
    let png = b"\x89PNG data";
    let pdf = b"%PDF-1.4";
    let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    let text = enex(&format!(
        "<note><title>Trip</title><content><![CDATA[<en-note><div>Packing <b>list</b></div><div><en-todo checked=\"true\"/>Passport</div><en-media hash=\"{}\" type=\"image/png\"/></en-note>]]></content>\
         <created>20261020T093000Z</created><tag>travel</tag>\
         <resource><data encoding=\"base64\">{}</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource>\
         <resource><data encoding=\"base64\">{}</data><mime>application/pdf</mime></resource></note>\
         <note><title>Trip</title><content><![CDATA[<en-note>Second trip</en-note>]]></content></note>\
         <note><title>a/b</title><content><![CDATA[<en-note><div>x</div></en-note>]]></content><resource><data>@@@</data><mime>image/png</mime></resource></note>",
        enex::md5_hex(png),
        b64(png),
        b64(pdf),
    ));
    let file = e.dir.path().join("Travel.enex");
    fs::write(&file, &text).unwrap();
    let p = inspect(ImportKind::Evernote, &file).unwrap();
    assert_eq!((p.name.as_str(), p.notes, p.attachments), ("Travel", 3, 3));
    assert_eq!(
        inspect(ImportKind::Notion, &file).unwrap().looks_like,
        Some(ImportKind::Evernote)
    );

    let mut last = (0, 0);
    let r = run(
        &e.vault,
        ImportKind::Evernote,
        &file,
        "Imported/Evernote",
        ImportOptions::default(),
        &mut |d, t| last = (d, t),
    )
    .unwrap();
    assert_eq!(last, (3, 3));
    assert_eq!((r.notes, r.attachments), (3, 2), "{r:?}");
    assert_eq!(r.skipped.len(), 1, "{:?}", r.skipped);
    let pdf_name = format!("{}.pdf", enex::md5_hex(pdf));
    assert_eq!(
        read(&e, "Imported/Evernote/Trip.md"),
        format!(
            "---\ncreated: \"2026-10-20T09:30:00Z\"\ntags:\n  - \"travel\"\n---\nPacking **list**\n- [x] Passport\n![](Attachments/map.png)\n\n[{pdf_name}](Attachments/{pdf_name})\n"
        )
    );
    assert_eq!(read(&e, "Imported/Evernote/Trip 2.md"), "Second trip\n");
    assert_eq!(read(&e, "Imported/Evernote/a-b.md"), "x\n");
    assert_eq!(
        fs::read(
            e.vault
                .resolve("Imported/Evernote/Attachments/map.png")
                .unwrap()
        )
        .unwrap(),
        png
    );

    // A folder of notebooks: one folder each.
    let books = e.dir.path().join("Books");
    write(
        &books,
        "Work.enex",
        enex("<note><title>A</title><content><![CDATA[<en-note>a</en-note>]]></content></note>")
            .as_bytes(),
    );
    write(
        &books,
        "Home.enex",
        enex("<note><title>B</title><content><![CDATA[<en-note>b</en-note>]]></content></note>")
            .as_bytes(),
    );
    write(&books, "notes.txt", b"not a notebook");
    let r = import(&e, ImportKind::Evernote, &books, "EN");
    assert_eq!(r.notes, 2);
    assert_eq!(read(&e, "EN/Work/A.md"), "a\n");
    assert_eq!(read(&e, "EN/Home/B.md"), "b\n");
    let empty = e.dir.path().join("Empty");
    fs::create_dir_all(&empty).unwrap();
    assert!(!inspect(ImportKind::Evernote, &empty)
        .unwrap()
        .warnings
        .is_empty());
}
