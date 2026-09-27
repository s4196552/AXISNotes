//! Obsidian's JSON Canvas (<https://jsoncanvas.org>) to an AXIS canvas (Excalidraw JSON).
//! Note nodes become live note cards; text and link nodes become cards with text; groups
//! become dashed frames; edges become arrows. Excalidraw fills in the element fields left
//! out here on load.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct JsonCanvas {
    #[serde(default)]
    nodes: Vec<Node>,
    #[serde(default)]
    edges: Vec<Edge>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Edge {
    id: String,
    from_node: String,
    to_node: String,
    #[serde(default)]
    from_side: Option<String>,
    #[serde(default)]
    to_side: Option<String>,
    #[serde(default)]
    label: Option<String>,
}

fn side_point(n: &Node, side: Option<&str>, toward: (f64, f64)) -> (f64, f64) {
    let (cx, cy) = (n.x + n.width / 2.0, n.y + n.height / 2.0);
    let side = side.map(str::to_string).unwrap_or_else(|| {
        let (dx, dy) = (toward.0 - cx, toward.1 - cy);
        if dx.abs() * n.height > dy.abs() * n.width {
            if dx > 0.0 { "right" } else { "left" }.into()
        } else if dy > 0.0 {
            "bottom".into()
        } else {
            "top".into()
        }
    });
    match side.as_str() {
        "top" => (cx, n.y),
        "bottom" => (cx, n.y + n.height),
        "left" => (n.x, cy),
        _ => (n.x + n.width, cy),
    }
}

fn text_element(id: &str, x: f64, y: f64, width: f64, text: &str) -> Value {
    let lines = text.lines().count().max(1) as f64;
    json!({
        "id": id, "type": "text", "x": x, "y": y,
        "width": width, "height": lines * 25.0,
        "text": text, "originalText": text,
        "fontSize": 16, "fontFamily": 5, "textAlign": "left", "verticalAlign": "top",
        "autoResize": false, "lineHeight": 1.25,
    })
}

/// A card like Obsidian's: a rounded box with the text bound inside it, so they move and
/// resize together.
fn card(id: &str, n: &Node, text: &str) -> [Value; 2] {
    let text_id = format!("{id}-t");
    let mut label = text_element(&text_id, n.x + 12.0, n.y + 12.0, n.width - 24.0, text);
    label["containerId"] = json!(id);
    [
        json!({
            "id": id, "type": "rectangle", "x": n.x, "y": n.y,
            "width": n.width, "height": n.height,
            "roundness": { "type": 3 }, "roughness": 0,
            "boundElements": [{ "type": "text", "id": text_id }],
        }),
        label,
    ]
}

/// Convert JSON Canvas text; `target` is the vault folder the vault was imported into.
pub fn json_canvas_to_axcanvas(text: &str, target: &str) -> Result<String, String> {
    let canvas: JsonCanvas = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let within = |p: &str| {
        if target.is_empty() {
            p.to_string()
        } else {
            format!("{target}/{p}")
        }
    };
    let mut elements = Vec::new();
    for n in &canvas.nodes {
        let id = format!("jc-{}", n.id);
        match n.kind.as_str() {
            "file" => {
                let file = n.file.clone().unwrap_or_default();
                if file.to_lowercase().ends_with(".md") {
                    elements.push(json!({
                        "id": id, "type": "embeddable", "x": n.x, "y": n.y,
                        "width": n.width, "height": n.height,
                        "link": format!("axis:{}", within(&file)),
                        "roundness": { "type": 3 }, "roughness": 0,
                    }));
                } else {
                    // Images and other files: a frame with the file name.
                    elements.push(json!({
                        "id": id, "type": "rectangle", "x": n.x, "y": n.y,
                        "width": n.width, "height": n.height, "roughness": 0,
                    }));
                    elements.push(text_element(
                        &format!("{id}-t"),
                        n.x + 10.0,
                        n.y + 10.0,
                        n.width - 20.0,
                        &format!("![[{file}]]"),
                    ));
                }
            }
            "link" => {
                let url = n.url.clone().unwrap_or_default();
                let [mut frame, label] = card(&id, n, &url);
                frame["link"] = json!(url);
                elements.extend([frame, label]);
            }
            "group" => {
                elements.push(json!({
                    "id": id, "type": "rectangle", "x": n.x, "y": n.y,
                    "width": n.width, "height": n.height,
                    "strokeStyle": "dashed", "roughness": 0,
                }));
                if let Some(label) = n.label.as_deref().filter(|l| !l.is_empty()) {
                    elements.push(text_element(
                        &format!("{id}-label"),
                        n.x,
                        n.y - 28.0,
                        n.width,
                        label,
                    ));
                }
            }
            _ => elements.extend(card(&id, n, n.text.as_deref().unwrap_or(""))),
        }
    }
    let by_id = |id: &str| canvas.nodes.iter().find(|n| n.id == id);
    for e in &canvas.edges {
        let (Some(a), Some(b)) = (by_id(&e.from_node), by_id(&e.to_node)) else {
            continue;
        };
        let bc = (b.x + b.width / 2.0, b.y + b.height / 2.0);
        let ac = (a.x + a.width / 2.0, a.y + a.height / 2.0);
        let s = side_point(a, e.from_side.as_deref(), bc);
        let t = side_point(b, e.to_side.as_deref(), ac);
        let arrow_id = format!("jc-{}", e.id);
        let (from, to) = (format!("jc-{}", a.id), format!("jc-{}", b.id));
        // Bound at both ends, so the arrow follows the cards when they move.
        for end in [&from, &to] {
            if let Some(el) = elements.iter_mut().find(|el| el["id"] == **end) {
                let mut bound = el["boundElements"].as_array().cloned().unwrap_or_default();
                bound.push(json!({ "type": "arrow", "id": arrow_id }));
                el["boundElements"] = json!(bound);
            }
        }
        elements.push(json!({
            "id": arrow_id, "type": "arrow", "x": s.0, "y": s.1,
            "width": (t.0 - s.0).abs(), "height": (t.1 - s.1).abs(),
            "points": [[0.0, 0.0], [t.0 - s.0, t.1 - s.1]],
            "startBinding": { "elementId": from, "focus": 0, "gap": 1 },
            "endBinding": { "elementId": to, "focus": 0, "gap": 1 },
            "endArrowhead": "arrow", "roughness": 0,
        }));
        if let Some(label) = e.label.as_deref().filter(|l| !l.is_empty()) {
            elements.push(text_element(
                &format!("jc-{}-label", e.id),
                (s.0 + t.0) / 2.0,
                (s.1 + t.1) / 2.0 - 12.0,
                160.0,
                label,
            ));
        }
    }
    let file = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "axis",
        "elements": elements,
        "appState": { "gridModeEnabled": false },
        "files": {},
    });
    Ok(serde_json::to_string_pretty(&file).unwrap() + "\n")
}
