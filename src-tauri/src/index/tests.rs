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
    assert!(v.root().join(".axis/index.db").exists());
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
