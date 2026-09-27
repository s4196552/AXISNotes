use super::*;

fn vault_with(files: &[(&str, &str)]) -> (tempfile::TempDir, Vault, Index) {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    for (path, text) in files {
        vault.write_file(path, text, None).unwrap();
    }
    let index = Index::open(&vault).unwrap();
    (dir, vault, index)
}

#[test]
fn resolves_by_name_path_folder_and_alias() {
    let (_d, _v, idx) = vault_with(&[
        ("Plan.md", ""),
        ("Work/Plan.md", ""),
        ("Work/Deep/Other.md", "---\naliases: [PA, Alpha]\n---\n"),
    ]);
    // Same folder wins, then shortest path.
    assert_eq!(
        idx.resolve("Plan", "Work/x.md").unwrap().as_deref(),
        Some("Work/Plan.md")
    );
    assert_eq!(
        idx.resolve("plan", "Home.md").unwrap().as_deref(),
        Some("Plan.md")
    );
    assert_eq!(
        idx.resolve("Work/Plan.md", "Home.md").unwrap().as_deref(),
        Some("Work/Plan.md")
    );
    assert_eq!(
        idx.resolve("Deep/Other", "Home.md").unwrap().as_deref(),
        Some("Work/Deep/Other.md")
    );
    assert_eq!(
        idx.resolve("alpha", "Home.md").unwrap().as_deref(),
        Some("Work/Deep/Other.md")
    );
    assert_eq!(idx.resolve("Missing", "Home.md").unwrap(), None);
    assert_eq!(
        idx.resolve("", "Home.md").unwrap().as_deref(),
        Some("Home.md")
    );
}

#[test]
fn backlinks_with_lines_and_context() {
    let (_d, _v, idx) = vault_with(&[
        ("Alpha.md", "---\naliases: [PA]\n---\n# Alpha"),
        (
            "A.md",
            "---\ntitle: x\n---\nintro\nsee [[Alpha]] now\nand ![[alpha#Goals]]",
        ),
        ("B.md", "via alias [[PA]]"),
        ("C.md", "unrelated [[Beta]]"),
    ]);
    let bl = idx.backlinks("Alpha.md").unwrap();
    assert_eq!(bl.len(), 2);
    assert_eq!(bl[0].source, "A.md");
    assert_eq!(bl[0].links.len(), 2);
    assert_eq!(bl[0].links[0].line, 5);
    assert_eq!(bl[0].links[0].context, "see [[Alpha]] now");
    assert!(bl[0].links[1].embed);
    assert_eq!(bl[1].source, "B.md");
}

#[test]
fn unlinked_mentions_skip_links_code_and_partial_words() {
    let (_d, v, idx) = vault_with(&[
        ("Project Alpha.md", ""),
        (
            "Notes.md",
            "Talked about project alpha today.\n[[Project Alpha]] linked.\n`Project Alpha` code\nProject Alphabet no.\nÉtude: Project Alpha!",
        ),
    ]);
    let m = idx.unlinked_mentions(&v, "Project Alpha.md").unwrap();
    let lines: Vec<usize> = m.iter().map(|x| x.line).collect();
    assert_eq!(lines, vec![1, 5]);
    assert_eq!(m[0].text, "project alpha");
    // UTF-16 offsets usable from JS.
    let text = std::fs::read_to_string(v.resolve("Notes.md").unwrap()).unwrap();
    let utf16: Vec<u16> = text.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&utf16[m[1].start..m[1].end]).unwrap(),
        "Project Alpha"
    );
}

#[test]
fn tags_count_notes_and_nested_tags_search() {
    let (_d, _v, idx) = vault_with(&[
        ("a.md", "#work/alpha #work"),
        ("b.md", "---\ntags: [work/beta]\n---\nbody #work/alpha"),
        ("c.md", "#home"),
    ]);
    let tags: Vec<(String, usize)> = idx
        .tags()
        .unwrap()
        .into_iter()
        .map(|t| (t.tag, t.count))
        .collect();
    assert_eq!(
        tags,
        vec![
            ("home".into(), 1),
            ("work".into(), 1),
            ("work/alpha".into(), 2),
            ("work/beta".into(), 1)
        ]
    );
    let hits: Vec<String> = idx
        .search("tag:work", 50)
        .unwrap()
        .into_iter()
        .map(|h| h.path)
        .collect();
    assert_eq!(hits.len(), 2);
    assert!(hits.contains(&"a.md".into()) && hits.contains(&"b.md".into()));
}

#[test]
fn search_text_phrases_negation_props_and_paths() {
    let (_d, _v, idx) = vault_with(&[
        ("School/Bio.md", "---\nstatus: done\ntags: [x]\n---\n# Biology\nThe mitochondria is the powerhouse of the cell."),
        ("School/Chem.md", "---\nstatus: draft\n---\nCells and molecules, plant cells."),
        ("Home.md", "---\nstatus: [done, archived]\n---\nNothing about biology here, powerhouse."),
    ]);
    let paths = |q: &str| -> Vec<String> {
        idx.search(q, 50)
            .unwrap()
            .into_iter()
            .map(|h| h.path)
            .collect()
    };

    assert_eq!(paths("mitochon"), vec!["School/Bio.md"]); // prefix
    let cell = paths("cell");
    assert_eq!(cell.len(), 2);
    assert_eq!(paths("\"powerhouse of the\""), vec!["School/Bio.md"]);
    assert_eq!(paths("cell -plant"), vec!["School/Bio.md"]);
    assert_eq!(paths("biology")[0], "School/Bio.md"); // title match ranks first
    assert_eq!(paths("prop:status=done").len(), 2); // scalar and list values
    assert_eq!(paths("prop:status=DRAFT"), vec!["School/Chem.md"]);
    assert_eq!(paths("powerhouse path:School"), vec!["School/Bio.md"]);
    assert_eq!(paths("file:chem"), vec!["School/Chem.md"]);
    assert!(paths("").is_empty());

    let hit = &idx.search("mitochondria", 5).unwrap()[0];
    assert_eq!(hit.title, "Biology");
    assert!(hit.snippet.contains("\u{1}mitochondria\u{2}"));
    // Odd input must not produce SQL/FTS errors.
    assert!(idx.search("\" ( AND * :", 5).is_ok());
}

#[test]
fn sync_picks_up_changes_and_deletions() {
    let (_d, v, mut idx) = vault_with(&[("a.md", "#one"), ("b.md", "")]);
    std::thread::sleep(std::time::Duration::from_millis(20));
    v.write_file("a.md", "#two", None).unwrap();
    std::fs::remove_file(v.resolve("b.md").unwrap()).unwrap();
    v.write_file("New/c.md", "#three", None).unwrap();
    idx.sync(&v).unwrap();
    let tags: Vec<String> = idx.tags().unwrap().into_iter().map(|t| t.tag).collect();
    assert_eq!(tags, vec!["three", "two"]);
    let names: Vec<String> = idx
        .list_notes()
        .unwrap()
        .into_iter()
        .map(|n| n.path)
        .collect();
    assert_eq!(names, vec!["New/c.md", "a.md"]);
}

#[test]
fn update_and_remove_single_paths() {
    let (_d, v, mut idx) = vault_with(&[("Dir/a.md", "x"), ("Dir/b.md", "y"), ("c.md", "z")]);
    v.write_file("c.md", "#fresh", None).unwrap();
    idx.update_path(&v, "c.md").unwrap();
    assert_eq!(idx.tags().unwrap()[0].tag, "fresh");
    idx.remove_path("Dir").unwrap();
    assert_eq!(idx.list_notes().unwrap().len(), 1);
}

#[test]
fn reopening_reuses_the_database() {
    let (_d, v, idx) = vault_with(&[("a.md", "#t")]);
    drop(idx);
    let idx = Index::open(&v).unwrap();
    assert_eq!(idx.tags().unwrap().len(), 1);
    assert!(v.root().join(".axisnotes/index.db").exists());
}

/// Phase 1 target: search under 100 ms on a 5,000-note vault.
/// Run with `cargo test --release perf_ -- --ignored --nocapture`.
#[test]
#[ignore]
fn perf_search_5000_notes() {
    use std::time::Instant;
    let dir = tempfile::tempdir().unwrap();
    let v = Vault::open(dir.path()).unwrap();
    let words = [
        "cell", "energy", "project", "alpha", "history", "matrix", "river", "poem", "budget",
        "plan",
    ];
    for i in 0..5000 {
        let w1 = words[i % words.len()];
        let w2 = words[(i * 7) % words.len()];
        let body = format!(
            "---\nstatus: {}\ntags: [area/{w1}]\n---\n# Note {i}\n\nThis note talks about {w1} and {w2}. \
             See [[Note {}]] and #topic/{w2}.\n\n{}",
            if i % 3 == 0 { "done" } else { "draft" },
            (i + 1) % 5000,
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)
        );
        v.write_file(&format!("Folder {}/Note {i}.md", i % 50), &body, None)
            .unwrap();
    }
    let t = Instant::now();
    let idx = Index::open(&v).unwrap();
    println!("initial index of 5000 notes: {:?}", t.elapsed());

    for q in [
        "energy",
        "\"talks about river\"",
        "tag:area/cell plan",
        "prop:status=done budget",
        "lorem -poem",
        "path:\"Folder 7\" matrix",
    ] {
        let t = Instant::now();
        let hits = idx.search(q, 50).unwrap();
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        println!("{q:>28}: {:>3} hits in {ms:.1} ms", hits.len());
        assert!(ms < 100.0, "{q} took {ms} ms");
    }
    let t = Instant::now();
    let bl = idx.backlinks("Folder 1/Note 1.md").unwrap();
    println!("backlinks: {} in {:?}", bl.len(), t.elapsed());
    let t = Instant::now();
    let n = idx.list_notes().unwrap().len();
    println!("list_notes: {n} in {:?}", t.elapsed());
    let t = Instant::now();
    let tags = idx.tags().unwrap().len();
    println!("tags: {tags} in {:?}", t.elapsed());
    let t = Instant::now();
    let g = idx.graph().unwrap();
    println!(
        "graph: {} nodes, {} edges in {:?}",
        g.nodes.len(),
        g.edges.len(),
        t.elapsed()
    );
    assert!(t.elapsed().as_millis() < 500);
}

#[test]
fn grids_are_searchable_by_cell_text_but_not_formulas() {
    let grid =
        r#"{"version":1,"rows":10,"cols":5,"cells":{"A1":"Groceries","B1":42,"C1":"=SUM(B1:B2)"}}"#;
    let (_d, vault, mut idx) = vault_with(&[("Budget.axgrid", grid), ("Note.md", "plain")]);
    let hits = idx.search("groceries", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].path, "Budget.axgrid");
    assert_eq!(hits[0].title, "Budget");
    assert!(idx.search("SUM", 10).unwrap().is_empty());
    assert_eq!(idx.search("42", 10).unwrap().len(), 1);

    // A grid can be linked with its extension.
    assert_eq!(
        idx.resolve("Budget.axgrid", "Note.md").unwrap().as_deref(),
        Some("Budget.axgrid")
    );

    // Invalid JSON indexes as empty instead of failing.
    vault.write_file("Budget.axgrid", "{oops", None).unwrap();
    idx.update_path(&vault, "Budget.axgrid").unwrap();
    assert!(idx.search("groceries", 10).unwrap().is_empty());
}

#[test]
fn unlinked_mentions_ignore_grids() {
    let grid = r#"{"cells":{"A1":"Alpha plan"}}"#;
    let (_d, vault, idx) = vault_with(&[
        ("Alpha.md", ""),
        ("Sheet.axgrid", grid),
        ("Doc.md", "about Alpha"),
    ]);
    let m = idx.unlinked_mentions(&vault, "Alpha.md").unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].source, "Doc.md");
}

#[test]
fn canvases_are_searchable_by_their_text_elements() {
    let board = r#"{"type":"excalidraw","elements":[
        {"type":"text","text":"Mitosis phases"},
        {"type":"text","text":"Removed idea","isDeleted":true},
        {"type":"embeddable","link":"axis:Bio.md"}
    ]}"#;
    let (_d, _v, idx) = vault_with(&[("Boards/Study.axcanvas", board)]);
    let hits = idx.search("mitosis", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].path, "Boards/Study.axcanvas");
    assert_eq!(hits[0].title, "Study");
    assert!(idx.search("removed", 10).unwrap().is_empty());
    assert_eq!(idx.canvas_paths().unwrap(), vec!["Boards/Study.axcanvas"]);
}

#[test]
fn tasks_are_indexed_with_file_line_numbers() {
    let (_d, vault, mut idx) = vault_with(&[
        (
            "Work.md",
            "---\ntitle: Work\n---\n# Todo\n- [ ] Ship 📅 2026-10-02 🔽\n- [x] Plan\n```\n- [ ] in code\n```\n",
        ),
        ("Home.md", "- [ ] Rent 📅 2026-10-01\n- [ ] Groceries ⏫\n"),
    ]);
    let t = idx.tasks().unwrap();
    let summary: Vec<(&str, usize, &str, bool)> = t
        .iter()
        .map(|t| (t.path.as_str(), t.line, t.text.as_str(), t.done))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("Home.md", 1, "Rent", false),
            ("Work.md", 5, "Ship", false),
            ("Home.md", 2, "Groceries", false),
            ("Work.md", 6, "Plan", true),
        ]
    );
    vault.write_file("Home.md", "nothing", None).unwrap();
    idx.update_path(&vault, "Home.md").unwrap();
    assert_eq!(idx.tasks().unwrap().len(), 2);
}

#[test]
fn time_entries_come_from_frontmatter_with_tags_and_project() {
    let (_d, _v, idx) = vault_with(&[
        (
            "Work/Report.md",
            "---\nproject: [Alpha]\ntags: [work]\ntime_log:\n  - start: 2026-09-26T10:00:00\n    end: 2026-09-26T10:30:00\n    task: Draft\n  - start: 2026-09-26T14:00:00\n  - end: 2026-09-26T15:00:00\n---\nbody #extra",
        ),
        ("Other.md", "---\ntime_log: nonsense\n---\n"),
    ]);
    let e = idx.time_entries().unwrap();
    assert_eq!(e.len(), 2);
    assert_eq!(e[0].start, "2026-09-26T10:00:00");
    assert_eq!(e[0].end.as_deref(), Some("2026-09-26T10:30:00"));
    assert_eq!(e[0].task.as_deref(), Some("Draft"));
    assert_eq!(e[0].tags, vec!["extra", "work"]);
    assert_eq!(e[0].project.as_deref(), Some("Alpha"));
    assert_eq!(e[1].end, None); // running
}

/// Opens the folder in `AXISNOTES_PROBE` the way the app does and times each step.
/// Run by hand: `AXISNOTES_PROBE=<dir> cargo test probe_big_vault -- --ignored --nocapture`.
#[test]
#[ignore]
fn probe_big_vault() {
    let Ok(dir) = std::env::var("AXISNOTES_PROBE") else {
        return;
    };
    let t = std::time::Instant::now();
    let v = crate::vault::Vault::open(std::path::Path::new(&dir)).unwrap();
    println!("vault open: {:?}", t.elapsed());
    let t = std::time::Instant::now();
    match v.list_tree() {
        Ok(tree) => {
            let json = serde_json::to_string(&tree).unwrap();
            println!(
                "list_tree: {:?}, {} KB of JSON",
                t.elapsed(),
                json.len() / 1024
            );
        }
        Err(e) => println!("list_tree FAILED after {:?}: {e}", t.elapsed()),
    }
    let t = std::time::Instant::now();
    match Index::open(&v) {
        Ok(_) => println!("index (first build): {:?}", t.elapsed()),
        Err(e) => println!("index FAILED: {e}"),
    }
    let t = std::time::Instant::now();
    Index::open(&v).unwrap();
    println!("index (reopen, nothing changed): {:?}", t.elapsed());
}

#[test]
fn sync_skips_link_loops_reports_progress_and_can_stop() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..1200 {
        std::fs::write(dir.path().join(format!("n{i}.md")), format!("# N{i}")).unwrap();
    }
    let v = crate::vault::Vault::open(dir.path()).unwrap();
    crate::vault::tests::link_dir(dir.path(), &dir.path().join("loop"));

    let mut idx = Index::open_unsynced(&v).unwrap();
    let mut seen = Vec::new();
    idx.sync_with_progress(&v, &|| false, &mut |d, t| seen.push((d, t)))
        .unwrap();
    assert_eq!(seen.first(), Some(&(0, 1200)));
    assert_eq!(seen.last(), Some(&(1200, 1200)));
    assert_eq!(idx.list_notes().unwrap().len(), 1200);

    // Nothing changed: nothing to read.
    let mut again = Vec::new();
    idx.sync_with_progress(&v, &|| false, &mut |d, t| again.push((d, t)))
        .unwrap();
    assert_eq!(again, [(0, 0)]);

    // A cancelled sync stops between batches.
    let fresh = tempfile::tempdir().unwrap();
    for i in 0..1200 {
        std::fs::write(fresh.path().join(format!("m{i}.md")), "x").unwrap();
    }
    let v2 = crate::vault::Vault::open(fresh.path()).unwrap();
    let mut idx2 = Index::open_unsynced(&v2).unwrap();
    idx2.sync_with_progress(&v2, &|| true, &mut |_, _| {})
        .unwrap();
    assert_eq!(idx2.list_notes().unwrap().len(), 0);
}
