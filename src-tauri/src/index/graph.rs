//! Whole-vault link graph for the graph view. Links are resolved in memory with the same
//! rules as `Index::resolve` (name, path narrowing, same folder, shortest path, aliases).

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::{db_err, note_name, strip_md, Index};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Note path, or `?<target>` for an unresolved link target.
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub unresolved: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

fn parent_dir(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

struct Resolver {
    by_name: HashMap<String, Vec<String>>,
    by_alias: HashMap<String, Vec<String>>,
}

impl Resolver {
    fn resolve(&self, target: &str, from: &str) -> Option<String> {
        let t = target.trim().replace('\\', "/");
        let t = strip_md(t.trim_start_matches('/'));
        if t.is_empty() {
            return None; // [[#Heading]] is a self link
        }
        let mut candidates: Vec<&String> = self
            .by_name
            .get(&note_name(t))
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        if t.contains('/') {
            let want = t.to_lowercase();
            candidates.retain(|p| {
                let p = strip_md(p).to_lowercase();
                p == want || p.ends_with(&format!("/{want}"))
            });
        } else if candidates.is_empty() {
            candidates = self
                .by_alias
                .get(&t.to_lowercase())
                .map(|v| v.iter().collect())
                .unwrap_or_default();
        }
        let dir = parent_dir(from);
        candidates
            .into_iter()
            .min_by(|a, b| {
                (parent_dir(a) != dir, a.len(), a.as_str()).cmp(&(
                    parent_dir(b) != dir,
                    b.len(),
                    b.as_str(),
                ))
            })
            .cloned()
    }
}

impl Index {
    pub fn graph(&self) -> AppResult<GraphData> {
        let conn = self.conn();
        let mut paths: HashMap<i64, String> = HashMap::new();
        let mut resolver = Resolver {
            by_name: HashMap::new(),
            by_alias: HashMap::new(),
        };
        {
            let mut stmt = conn
                .prepare("SELECT id, path, name FROM notes")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(db_err)?;
            for row in rows {
                let (id, path, name) = row.map_err(db_err)?;
                resolver.by_name.entry(name).or_default().push(path.clone());
                paths.insert(id, path);
            }
        }
        {
            let mut stmt = conn
                .prepare("SELECT note_id, alias FROM aliases")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(db_err)?;
            for row in rows {
                let (id, alias) = row.map_err(db_err)?;
                if let Some(p) = paths.get(&id) {
                    resolver
                        .by_alias
                        .entry(alias.to_lowercase())
                        .or_default()
                        .push(p.clone());
                }
            }
        }
        let mut tags: HashMap<i64, Vec<String>> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT note_id, tag FROM tags ORDER BY tag")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(db_err)?;
            for row in rows {
                let (id, tag) = row.map_err(db_err)?;
                tags.entry(id).or_default().push(tag);
            }
        }

        let mut nodes: Vec<GraphNode> = paths
            .iter()
            .map(|(id, path)| GraphNode {
                id: path.clone(),
                name: strip_md(path.rsplit('/').next().unwrap_or(path)).to_string(),
                tags: tags.remove(id).unwrap_or_default(),
                unresolved: false,
            })
            .collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));

        let mut edges: BTreeSet<GraphEdge> = BTreeSet::new();
        let mut ghosts: BTreeSet<String> = BTreeSet::new();
        let mut stmt = conn
            .prepare("SELECT note_id, target FROM links")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_err)?;
        for row in rows {
            let (id, target) = row.map_err(db_err)?;
            let Some(source) = paths.get(&id) else {
                continue;
            };
            let resolved = match resolver.resolve(&target, source) {
                Some(p) => p,
                None if !target.trim().is_empty() => {
                    let ghost = format!("?{}", strip_md(target.trim()));
                    ghosts.insert(ghost.clone());
                    ghost
                }
                None => continue,
            };
            if &resolved != source {
                edges.insert(GraphEdge {
                    source: source.clone(),
                    target: resolved,
                });
            }
        }
        nodes.extend(ghosts.into_iter().map(|g| GraphNode {
            name: g[1..].rsplit('/').next().unwrap_or(&g[1..]).to_string(),
            id: g,
            tags: Vec::new(),
            unresolved: true,
        }));
        Ok(GraphData {
            nodes,
            edges: edges.into_iter().collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;

    #[test]
    fn builds_nodes_edges_ghosts_and_matches_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        for (p, t) in [
            ("Plan.md", "#top"),
            ("Work/Plan.md", "---\naliases: [WP]\n---\n"),
            (
                "Work/Note.md",
                "[[Plan]] [[WP]] [[Missing Note]] [[#Self]] [[Plan]]",
            ),
            ("Home.md", "[[Plan]] [[Work/Plan]] #home #top"),
        ] {
            v.write_file(p, t, None).unwrap();
        }
        let idx = Index::open(&v).unwrap();
        let g = idx.graph().unwrap();
        let ids: Vec<&str> = g.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "Home.md",
                "Plan.md",
                "Work/Note.md",
                "Work/Plan.md",
                "?Missing Note"
            ]
        );
        assert_eq!(g.nodes[0].tags, vec!["home", "top"]);
        assert!(g.nodes[4].unresolved);
        let edges: Vec<(&str, &str)> = g
            .edges
            .iter()
            .map(|e| (e.source.as_str(), e.target.as_str()))
            .collect();
        assert_eq!(
            edges,
            vec![
                ("Home.md", "Plan.md"),
                ("Home.md", "Work/Plan.md"),
                ("Work/Note.md", "?Missing Note"),
                ("Work/Note.md", "Work/Plan.md"),
            ]
        );
    }
}
