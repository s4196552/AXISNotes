//! Rename/move a note or folder and rewrite the wikilinks that pointed at it.

use std::collections::BTreeMap;

use super::{is_indexed, strip_md, Index, LinkSite};
use crate::error::AppResult;
use crate::vault::{Vault, VaultEntry};

pub struct RenameOutcome {
    pub entry: VaultEntry,
    /// Notes whose content was rewritten (new paths).
    pub updated: Vec<String>,
}

fn basename_no_md(p: &str) -> &str {
    strip_md(p.rsplit('/').next().unwrap_or(p))
}

/// Rename `from` → `to` on disk, update the index, and rewrite incoming links so they
/// still point at the moved notes. Links that still resolve (e.g. via an alias, or a
/// bare name after a folder move) are left untouched.
pub fn rename_with_links(
    vault: &Vault,
    index: &mut Index,
    from: &str,
    to: &str,
    mut before_write: impl FnMut(&str),
) -> AppResult<RenameOutcome> {
    let is_dir = vault.resolve(from)?.is_dir();
    let moves: Vec<(String, String)> = if is_dir {
        index
            .note_paths_under(from)?
            .into_iter()
            .map(|p| {
                let new = format!("{to}{}", &p[from.len()..]);
                (p, new)
            })
            .collect()
    } else if is_indexed(from) {
        vec![(from.to_string(), to.to_string())]
    } else {
        Vec::new()
    };

    let mut sites: Vec<(LinkSite, String)> = Vec::new(); // (site, new target path)
    for (old, new) in &moves {
        for site in index.links_into(old)? {
            sites.push((site, new.clone()));
        }
    }

    let entry = vault.rename_entry(from, to)?;
    index.remove_path(from)?;
    index.update_path(vault, to)?;

    let moved_source = |p: &str| -> String {
        moves
            .iter()
            .find(|(o, _)| o == p)
            .map_or_else(|| p.to_string(), |(_, n)| n.clone())
    };

    // source note -> [(byte range of old target, old target text, replacement)]
    let mut edits: BTreeMap<String, Vec<(usize, usize, String, String)>> = BTreeMap::new();
    for (site, new_path) in sites {
        let source = moved_source(&site.source);
        if index.resolve(&site.target, &source)?.as_deref() == Some(new_path.as_str()) {
            continue; // still resolves (alias, or unchanged name after a folder move)
        }
        let new_full = strip_md(&new_path).to_string();
        let mut replacement = if site.target.contains('/') {
            new_full.clone()
        } else {
            basename_no_md(&new_path).to_string()
        };
        if index.resolve(&replacement, &source)?.as_deref() != Some(new_path.as_str()) {
            replacement = new_full;
        }
        if replacement != site.target {
            edits.entry(source).or_default().push((
                site.target_start,
                site.target_end,
                site.target,
                replacement,
            ));
        }
    }

    let mut updated = Vec::new();
    for (source, mut list) in edits {
        let abs = vault.resolve(&source)?;
        let Ok(mut text) = std::fs::read_to_string(&abs) else {
            continue;
        };
        list.sort_by_key(|e| std::cmp::Reverse(e.0)); // back to front keeps earlier offsets valid
        let mut changed = false;
        for (start, end, old, new) in list {
            // Only edit if the index still matches the file (it may have changed since).
            if text.get(start..end) == Some(old.as_str()) {
                text.replace_range(start..end, &new);
                changed = true;
            }
        }
        if changed {
            before_write(&source);
            vault.write_file(&source, &text, None)?;
            index.update_path(vault, &source)?;
            updated.push(source);
        }
    }
    Ok(RenameOutcome { entry, updated })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(files: &[(&str, &str)]) -> (tempfile::TempDir, Vault, Index) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        for (p, t) in files {
            v.write_file(p, t, None).unwrap();
        }
        let idx = Index::open(&v).unwrap();
        (dir, v, idx)
    }

    fn read(v: &Vault, p: &str) -> String {
        std::fs::read_to_string(v.resolve(p).unwrap()).unwrap()
    }

    #[test]
    fn renaming_a_note_rewrites_links_keeping_heading_alias_and_embed() {
        let (_d, v, mut idx) = setup(&[
            ("Old.md", "# Old"),
            (
                "A.md",
                "[[Old]] and [[old#Sec|see]] and ![[Old#^b1]] and [[Other]]",
            ),
            ("Sub/B.md", "[[Old.md]]"),
        ]);
        let out = rename_with_links(&v, &mut idx, "Old.md", "New Name.md", |_| {}).unwrap();
        assert_eq!(out.entry.path, "New Name.md");
        assert_eq!(
            read(&v, "A.md"),
            "[[New Name]] and [[New Name#Sec|see]] and ![[New Name#^b1]] and [[Other]]"
        );
        assert_eq!(read(&v, "Sub/B.md"), "[[New Name]]");
        assert_eq!(out.updated, vec!["A.md", "Sub/B.md"]);
        assert_eq!(idx.backlinks("New Name.md").unwrap().len(), 2);
    }

    #[test]
    fn moving_keeps_bare_links_and_updates_path_links() {
        let (_d, v, mut idx) = setup(&[
            ("Notes/Plan.md", ""),
            ("A.md", "[[Plan]] and [[Notes/Plan]]"),
        ]);
        let out =
            rename_with_links(&v, &mut idx, "Notes/Plan.md", "Archive/Plan.md", |_| {}).unwrap();
        assert_eq!(read(&v, "A.md"), "[[Plan]] and [[Archive/Plan]]");
        assert_eq!(out.updated, vec!["A.md"]);
    }

    #[test]
    fn uses_a_path_when_the_new_name_would_be_ambiguous() {
        let (_d, v, mut idx) = setup(&[
            ("Topic.md", ""),
            ("Work/Idea.md", ""),
            ("Work/Note.md", "[[Idea]]"),
        ]);
        rename_with_links(&v, &mut idx, "Work/Idea.md", "Work/Topic.md", |_| {}).unwrap();
        // "Topic" from Work/Note.md resolves to Work/Topic.md (same folder), so the bare name works.
        assert_eq!(read(&v, "Work/Note.md"), "[[Topic]]");

        let (_d2, v2, mut idx2) = setup(&[
            ("Topic.md", ""),
            ("Work/Idea.md", ""),
            ("Home.md", "[[Idea]]"),
        ]);
        rename_with_links(&v2, &mut idx2, "Work/Idea.md", "Work/Topic.md", |_| {}).unwrap();
        // From the root, bare "Topic" would hit Topic.md, so the path is used.
        assert_eq!(read(&v2, "Home.md"), "[[Work/Topic]]");
    }

    #[test]
    fn alias_links_and_folder_renames() {
        let (_d, v, mut idx) = setup(&[
            ("Proj/Alpha.md", "---\naliases: [PA]\n---\n"),
            ("Proj/Beta.md", "[[Alpha]] [[Proj/Alpha]] [[PA]]"),
            ("Home.md", "[[Proj/Beta]]"),
        ]);
        let out = rename_with_links(&v, &mut idx, "Proj", "Projects", |_| {}).unwrap();
        assert_eq!(out.entry.path, "Projects");
        // Self-folder note is rewritten at its new location; alias link untouched.
        assert_eq!(
            read(&v, "Projects/Beta.md"),
            "[[Alpha]] [[Projects/Alpha]] [[PA]]"
        );
        assert_eq!(read(&v, "Home.md"), "[[Projects/Beta]]");
        assert_eq!(out.updated, vec!["Home.md", "Projects/Beta.md"]);
    }
}
