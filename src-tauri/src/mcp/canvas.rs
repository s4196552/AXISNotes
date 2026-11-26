//! Canvases for Claude: read a `.axcanvas` file (an Excalidraw scene) as a short list of
//! shapes, add labelled shapes, note cards and arrows, and move, resize, relabel, recolor
//! or delete them.
//!
//! Elements are written as complete Excalidraw elements, so the file stays a valid scene
//! whether or not AXISNotes is open. Text sizes can only be estimated here, so text written
//! by these tools carries `customData.axisRemeasure`; the app measures it with the real font
//! and clears the flag when it shows the canvas. An open canvas takes the change in place
//! (see `src/features/canvas/liveMerge.ts`).

use std::collections::{HashMap, HashSet};

use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Map, Value};

use crate::ai::log::now_ms;

/// The flag on text whose size is an estimate (the app re-measures it).
pub const REMEASURE: &str = "axisRemeasure";
/// The most elements `read_canvas` lists.
pub const MAX_LISTED: usize = 2000;
/// The most shapes plus arrows one call may add.
pub const MAX_ADDED: usize = 200;

const FONT_FAMILY: u64 = 5; // Excalifont, Excalidraw's default hand-drawn font
const LINE_HEIGHT: f64 = 1.25;
const CHAR_WIDTH: f64 = 0.55; // of the font size, on average
const PADDING: f64 = 5.0; // Excalidraw's padding around a container's text
const STROKE: &str = "#1e1e1e";
const CARD: (f64, f64) = (320.0, 220.0);
const SHAPE_TYPES: [&str; 3] = ["rectangle", "ellipse", "diamond"];

pub type Rng = SystemRandom;

fn rand_u32(rng: &Rng) -> u32 {
    let mut b = [0u8; 4];
    let _ = rng.fill(&mut b);
    u32::from_le_bytes(b)
}

/// A new element id, in Excalidraw's style (21 URL-safe characters).
pub fn new_id(rng: &Rng) -> String {
    const ABC: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
    let mut b = [0u8; 21];
    let _ = rng.fill(&mut b);
    b.iter().map(|x| ABC[(*x & 63) as usize] as char).collect()
}

/// The file's JSON object, with an `elements` array (an empty file is an empty canvas).
pub fn parse(text: &str) -> Result<Value, String> {
    let mut file = if text.trim().is_empty() {
        empty()
    } else {
        serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .ok_or("This canvas file can't be read (it isn't an Excalidraw scene).")?
    };
    if !file.get("elements").is_some_and(Value::is_array) {
        file["elements"] = json!([]);
    }
    Ok(file)
}

pub fn empty() -> Value {
    json!({
        "type": "excalidraw", "version": 2, "source": "axis",
        "elements": [], "appState": { "gridModeEnabled": false }, "files": {}
    })
}

/// As the app writes canvases: two-space JSON and a final newline.
pub fn serialize(file: &Value) -> String {
    serde_json::to_string_pretty(file).unwrap_or_default() + "\n"
}

// ---- Small accessors ----

fn s<'a>(e: &'a Value, k: &str) -> Option<&'a str> {
    e.get(k).and_then(Value::as_str)
}
fn f(e: &Value, k: &str) -> f64 {
    e.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn live(e: &Value) -> bool {
    e.get("isDeleted").and_then(Value::as_bool) != Some(true)
}
fn round(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn elements(file: &Value) -> &Vec<Value> {
    file["elements"].as_array().expect("parse() makes it an array")
}
fn elements_mut(file: &mut Value) -> &mut Vec<Value> {
    file["elements"].as_array_mut().expect("parse() makes it an array")
}
fn card_note(e: &Value) -> Option<&str> {
    (s(e, "type") == Some("embeddable"))
        .then(|| s(e, "link")?.strip_prefix("axis:"))
        .flatten()
}
/// The id of the text bound inside this element, if any.
fn bound_text(e: &Value) -> Option<String> {
    e.get("boundElements")?
        .as_array()?
        .iter()
        .find(|b| s(b, "type") == Some("text"))
        .and_then(|b| s(b, "id"))
        .map(str::to_string)
}

fn touch(e: &mut Value, rng: &Rng) {
    let v = e.get("version").and_then(Value::as_u64).unwrap_or(1);
    e["version"] = json!(v + 1);
    e["versionNonce"] = json!(rand_u32(rng) >> 1);
    e["updated"] = json!(now_ms());
}

// ---- Reading ----

/// The canvas as Claude sees it: one entry per live element, labels folded into their
/// shape or arrow, positions rounded.
pub fn summary(file: &Value) -> (Vec<Value>, bool) {
    let els = elements(file);
    let by_id: HashMap<&str, &Value> = els
        .iter()
        .filter(|e| live(e))
        .filter_map(|e| Some((s(e, "id")?, e)))
        .collect();
    let label = |e: &Value| {
        bound_text(e)
            .and_then(|id| by_id.get(id.as_str()).copied())
            .and_then(|t| s(t, "text"))
            .map(|t| t.chars().take(500).collect::<String>())
    };
    let mut out = Vec::new();
    let mut total = 0;
    for e in els.iter().filter(|e| live(e)) {
        let kind = s(e, "type").unwrap_or("");
        // Text inside a live shape or arrow is shown as that element's label.
        if kind == "text"
            && s(e, "containerId").is_some_and(|c| by_id.contains_key(c))
        {
            continue;
        }
        total += 1;
        if out.len() >= MAX_LISTED {
            continue;
        }
        let mut item = Map::new();
        item.insert("id".into(), json!(s(e, "id")));
        let box_ = |item: &mut Map<String, Value>| {
            for k in ["x", "y", "width", "height"] {
                item.insert(k.into(), json!(round(f(e, k))));
            }
        };
        match kind {
            "arrow" | "line" => {
                item.insert("type".into(), json!(kind));
                let end = |k: &str| {
                    e.get(k)
                        .and_then(|b| s(b, "elementId"))
                        .filter(|id| by_id.contains_key(id))
                };
                if let Some(id) = end("startBinding") {
                    item.insert("from".into(), json!(id));
                }
                if let Some(id) = end("endBinding") {
                    item.insert("to".into(), json!(id));
                }
                let pts = e.get("points").and_then(Value::as_array);
                let pt = |p: Option<&Value>| {
                    p.and_then(Value::as_array).map(|xy| {
                        let at = |i: usize| xy.get(i).and_then(Value::as_f64).unwrap_or(0.0);
                        json!([round(f(e, "x") + at(0)), round(f(e, "y") + at(1))])
                    })
                };
                if let Some(p) = pt(pts.and_then(|p| p.first())) {
                    item.insert("start".into(), p);
                }
                if let Some(p) = pt(pts.and_then(|p| p.last())) {
                    item.insert("end".into(), p);
                }
                if let Some(t) = label(e) {
                    item.insert("label".into(), json!(t));
                }
            }
            "embeddable" if card_note(e).is_some() => {
                item.insert("type".into(), json!("noteCard"));
                item.insert("note".into(), json!(card_note(e)));
                box_(&mut item);
            }
            "text" => {
                item.insert("type".into(), json!("text"));
                box_(&mut item);
                let text: String = s(e, "text").unwrap_or("").chars().take(500).collect();
                item.insert("text".into(), json!(text));
                item.insert("fontSize".into(), json!(f(e, "fontSize")));
            }
            _ => {
                item.insert("type".into(), json!(kind));
                box_(&mut item);
                if let Some(t) = label(e) {
                    item.insert("text".into(), json!(t));
                }
                if kind == "embeddable" || kind == "iframe" {
                    if let Some(l) = s(e, "link") {
                        item.insert("link".into(), json!(l));
                    }
                }
            }
        }
        if matches!(kind, "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line") {
            if let Some(c) = s(e, "strokeColor").filter(|c| *c != STROKE) {
                item.insert("strokeColor".into(), json!(c));
            }
            if let Some(c) = s(e, "backgroundColor").filter(|c| *c != "transparent") {
                item.insert("backgroundColor".into(), json!(c));
            }
        }
        out.push(Value::Object(item));
    }
    (out, total > MAX_LISTED)
}

// ---- Building elements ----

fn base(kind: &str, id: &str, b: (f64, f64, f64, f64), stroke: &str, bg: &str, rng: &Rng) -> Value {
    let roundness = match kind {
        "rectangle" | "embeddable" => json!({ "type": 3 }),
        "arrow" | "line" | "diamond" | "ellipse" => json!({ "type": 2 }),
        _ => Value::Null,
    };
    json!({
        "id": id, "type": kind,
        "x": b.0, "y": b.1, "width": b.2, "height": b.3, "angle": 0,
        "strokeColor": stroke, "backgroundColor": bg,
        "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": null, "roundness": roundness,
        "seed": rand_u32(rng) >> 1, "version": 1, "versionNonce": rand_u32(rng) >> 1,
        "isDeleted": false, "boundElements": [], "updated": now_ms(),
        "link": null, "locked": false,
    })
}

/// Lines of `text` wrapped to `max_chars` (by words), for size estimates.
fn wrapped_lines(text: &str, max_chars: usize) -> Vec<String> {
    let max_chars = max_chars.max(1);
    let mut out = Vec::new();
    for para in text.split('\n') {
        let mut line = String::new();
        for word in para.split(' ') {
            let len = line.chars().count();
            if len > 0 && len + 1 + word.chars().count() > max_chars {
                out.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        out.push(line);
    }
    out
}

/// Estimated (width, height) of text at `size`, wrapped to `max_width` if given.
fn text_size(text: &str, size: f64, max_width: Option<f64>) -> (f64, f64) {
    let lines = match max_width {
        Some(w) => wrapped_lines(text, (w / (size * CHAR_WIDTH)).floor() as usize),
        None => text.split('\n').map(str::to_string).collect(),
    };
    let longest = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64;
    let mut w = (longest * size * CHAR_WIDTH).ceil().max(size * 0.5);
    if let Some(m) = max_width {
        w = w.min(m);
    }
    (w, (lines.len() as f64 * size * LINE_HEIGHT).ceil())
}

fn text_element(id: &str, at: (f64, f64), text: &str, size: f64, stroke: &str, container: Option<&str>, max_width: Option<f64>, rng: &Rng) -> Value {
    let (w, h) = text_size(text, size, max_width);
    let mut e = base("text", id, (at.0, at.1, w, h), stroke, "transparent", rng);
    let centered = container.is_some();
    for (k, v) in [
        ("text", json!(text)),
        ("originalText", json!(text)),
        ("fontSize", json!(size)),
        ("fontFamily", json!(FONT_FAMILY)),
        ("textAlign", json!(if centered { "center" } else { "left" })),
        ("verticalAlign", json!(if centered { "middle" } else { "top" })),
        ("containerId", json!(container)),
        ("autoResize", json!(true)),
        ("lineHeight", json!(LINE_HEIGHT)),
        ("customData", json!({ REMEASURE: true })),
    ] {
        e[k] = v;
    }
    e["boundElements"] = Value::Null;
    e
}

/// The widest a container's text may be.
fn label_width(container: &Value) -> f64 {
    let w = f(container, "width");
    let inner = match s(container, "type") {
        // Excalidraw fits text in the box inscribed in ellipses and diamonds.
        Some("ellipse") => w * std::f64::consts::FRAC_1_SQRT_2,
        Some("diamond") => w / 2.0,
        _ => w,
    };
    (inner - 2.0 * PADDING).max(20.0)
}

/// Center `text` on `container` (a shape's middle, or an arrow's midpoint).
fn center_label(text: &mut Value, container: &Value) {
    let (cx, cy) = if matches!(s(container, "type"), Some("arrow" | "line")) {
        let (a, b) = arrow_ends(container);
        ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0)
    } else {
        center(container)
    };
    text["x"] = json!(round(cx - f(text, "width") / 2.0));
    text["y"] = json!(round(cy - f(text, "height") / 2.0));
}

fn center(e: &Value) -> (f64, f64) {
    (f(e, "x") + f(e, "width") / 2.0, f(e, "y") + f(e, "height") / 2.0)
}

fn arrow_ends(e: &Value) -> ((f64, f64), (f64, f64)) {
    let pts = e.get("points").and_then(Value::as_array);
    let at = |p: Option<&Value>| {
        let xy = p.and_then(Value::as_array);
        let c = |i: usize| xy.and_then(|v| v.get(i)).and_then(Value::as_f64).unwrap_or(0.0);
        (f(e, "x") + c(0), f(e, "y") + c(1))
    };
    (at(pts.and_then(|p| p.first())), at(pts.and_then(|p| p.last())))
}

/// Where the line from `box_`'s center toward `to` leaves the box, plus a small gap.
fn border(box_: &Value, to: (f64, f64)) -> (f64, f64) {
    let c = center(box_);
    let (dx, dy) = (to.0 - c.0, to.1 - c.1);
    if dx == 0.0 && dy == 0.0 {
        return c;
    }
    let (hw, hh) = (f(box_, "width") / 2.0, f(box_, "height") / 2.0);
    let scale = (if dx != 0.0 { hw / dx.abs() } else { f64::INFINITY })
        .min(if dy != 0.0 { hh / dy.abs() } else { f64::INFINITY });
    let gap = 6.0 / dx.hypot(dy);
    (c.0 + dx * (scale + gap), c.1 + dy * (scale + gap))
}

/// Point `arrow` from `a`'s border to `b`'s.
fn route(arrow: &mut Value, a: &Value, b: &Value) {
    let s_ = border(a, center(b));
    let t = border(b, center(a));
    arrow["x"] = json!(round(s_.0));
    arrow["y"] = json!(round(s_.1));
    arrow["width"] = json!(round((t.0 - s_.0).abs()));
    arrow["height"] = json!(round((t.1 - s_.1).abs()));
    arrow["points"] = json!([[0, 0], [round(t.0 - s_.0), round(t.1 - s_.1)]]);
}

fn push_bound(e: &mut Value, kind: &str, id: &str) {
    if !e.get("boundElements").is_some_and(Value::is_array) {
        e["boundElements"] = json!([]);
    }
    e["boundElements"]
        .as_array_mut()
        .expect("just made an array")
        .push(json!({ "type": kind, "id": id }));
}

fn color(args: &Value, key: &str) -> Result<Option<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(c)) if !c.trim().is_empty() && c.len() <= 40 => Ok(Some(c.trim().to_string())),
        Some(_) => Err(format!("\"{key}\" must be a color such as \"#1971c2\", \"red\" or \"transparent\".")),
    }
}

fn number(args: &Value, key: &str) -> Result<Option<f64>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|n| n.is_finite() && n.abs() < 1e7)
            .map(Some)
            .ok_or_else(|| format!("\"{key}\" must be a number.")),
    }
}

fn size_arg(args: &Value, key: &str) -> Result<Option<f64>, String> {
    let n = number(args, key)?;
    if n.is_some_and(|n| n < 1.0) {
        return Err(format!("\"{key}\" must be at least 1."));
    }
    Ok(n)
}

/// What `add` did: the ids of the new elements, in the order they were given.
#[derive(Debug)]
pub struct Added {
    pub shapes: Vec<String>,
    pub arrows: Vec<String>,
}

/// Add shapes, note cards, text and arrows. `note_ok` says whether a note card may show
/// that note (it must exist and be shared with Claude).
pub fn add(
    file: &mut Value,
    shapes: &[Value],
    arrows: &[Value],
    note_ok: &dyn Fn(&str) -> Result<String, String>,
    rng: &Rng,
) -> Result<Added, String> {
    if shapes.len() + arrows.len() > MAX_ADDED {
        return Err(format!("Add at most {MAX_ADDED} shapes and arrows at a time."));
    }
    if shapes.is_empty() && arrows.is_empty() {
        return Err("Give at least one shape or arrow to add.".into());
    }
    let mut taken: HashSet<String> = elements(file)
        .iter()
        .filter_map(|e| s(e, "id").map(str::to_string))
        .collect();
    let mut pick_id = |given: Option<&str>, what: &str| -> Result<String, String> {
        match given.map(str::trim).filter(|g| !g.is_empty()) {
            Some(g) => {
                if g.len() > 64 || !g.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c)) {
                    return Err(format!("The {what} id \"{g}\" may only use letters, digits and - _ . : (up to 64)."));
                }
                if !taken.insert(g.to_string()) {
                    return Err(format!("The id \"{g}\" is already used on this canvas; pick another or leave it out."));
                }
                Ok(g.to_string())
            }
            None => loop {
                let id = new_id(rng);
                if taken.insert(id.clone()) {
                    break Ok(id);
                }
            },
        }
    };

    // Where shapes without a position go: a grid to the right of what's there.
    let live_boxes: Vec<(f64, f64, f64, f64)> = elements(file)
        .iter()
        .filter(|e| live(e))
        .map(|e| (f(e, "x"), f(e, "y"), f(e, "width"), f(e, "height")))
        .collect();
    let mut cursor = if live_boxes.is_empty() {
        (0.0, 0.0)
    } else {
        (
            live_boxes.iter().map(|b| b.0 + b.2).fold(f64::MIN, f64::max) + 120.0,
            live_boxes.iter().map(|b| b.1).fold(f64::MAX, f64::min),
        )
    };
    let grid_left = cursor.0;
    let mut row_height: f64 = 0.0;
    let mut in_row = 0;

    let mut new_els: Vec<Value> = Vec::new();
    let mut added = Added { shapes: vec![], arrows: vec![] };
    for (i, sh) in shapes.iter().enumerate() {
        let what = format!("shapes[{i}]");
        let kind = s(sh, "type").unwrap_or("rectangle");
        let text = s(sh, "text").map(str::trim_end).filter(|t| !t.is_empty());
        let stroke = color(sh, "strokeColor")?.unwrap_or_else(|| STROKE.into());
        let bg = color(sh, "backgroundColor")?.unwrap_or_else(|| "transparent".into());
        let font = number(sh, "fontSize")?.unwrap_or(if kind == "text" { 20.0 } else { 16.0 }).clamp(8.0, 200.0);
        let id = pick_id(s(sh, "id"), &what)?;
        let (mut w, mut h) = (size_arg(sh, "width")?, size_arg(sh, "height")?);
        let mut el = match kind {
            "rectangle" | "ellipse" | "diamond" => {
                if w.is_none() || h.is_none() {
                    let label = text.unwrap_or("");
                    let (tw, _) = text_size(label, font, None);
                    let grow = if kind == "rectangle" { 1.0 } else { 1.6 };
                    let dw = ((tw.min(240.0) + 40.0) * grow).clamp(120.0, 420.0);
                    let width = w.unwrap_or(dw);
                    let inner = label_width(&json!({ "type": kind, "width": width }));
                    let (_, th) = text_size(label, font, Some(inner));
                    w = Some(width);
                    h = h.or(Some(((th + 30.0) * if kind == "rectangle" { 1.0 } else { 1.5 }).max(60.0)));
                }
                base(kind, &id, (0.0, 0.0, w.unwrap(), h.unwrap()), &stroke, &bg, rng)
            }
            "text" => {
                let t = text.ok_or(format!("{what} is text, so it needs \"text\"."))?;
                text_element(&id, (0.0, 0.0), t, font, &stroke, None, w, rng)
            }
            "noteCard" => {
                let asked = s(sh, "note").ok_or(format!("{what} is a noteCard, so it needs \"note\" (a note's path)."))?;
                let note = note_ok(asked)?;
                let mut e = base("embeddable", &id, (0.0, 0.0, w.unwrap_or(CARD.0), h.unwrap_or(CARD.1)), STROKE, "transparent", rng);
                e["link"] = json!(format!("axis:{note}"));
                e["roughness"] = json!(0);
                e
            }
            other => {
                return Err(format!(
                    "{what}: \"{other}\" isn't a shape type; use rectangle, ellipse, diamond, text or noteCard."
                ))
            }
        };
        let (ew, eh) = (f(&el, "width"), f(&el, "height"));
        let (x, y) = match (number(sh, "x")?, number(sh, "y")?) {
            (Some(x), Some(y)) => (x, y),
            (None, None) => {
                if in_row == 4 {
                    cursor = (grid_left, cursor.1 + row_height + 60.0);
                    row_height = 0.0;
                    in_row = 0;
                }
                let at = cursor;
                cursor.0 += ew + 80.0;
                row_height = row_height.max(eh);
                in_row += 1;
                at
            }
            _ => return Err(format!("{what}: give both \"x\" and \"y\", or neither to place it automatically.")),
        };
        el["x"] = json!(round(x));
        el["y"] = json!(round(y));
        if let (Some(t), true) = (text, SHAPE_TYPES.contains(&kind)) {
            let tid = pick_id(None, "label")?;
            let mut te = text_element(&tid, (0.0, 0.0), t, font, &stroke, Some(&id), Some(label_width(&el)), rng);
            center_label(&mut te, &el);
            push_bound(&mut el, "text", &tid);
            new_els.push(el);
            new_els.push(te);
        } else {
            new_els.push(el);
        }
        added.shapes.push(id);
    }

    for (i, ar) in arrows.iter().enumerate() {
        let what = format!("arrows[{i}]");
        let end = |k: &str| -> Result<String, String> {
            s(ar, k)
                .map(str::to_string)
                .ok_or(format!("{what} needs \"{k}\": the id of a shape (new or already on the canvas)."))
        };
        let (from, to) = (end("from")?, end("to")?);
        let find = |els: &Vec<Value>, id: &str| {
            els.iter().position(|e| live(e) && s(e, "id") == Some(id) && is_target(e))
        };
        let a_new = find(&new_els, &from);
        let a_old = find(elements(file), &from);
        let b_new = find(&new_els, &to);
        let b_old = find(elements(file), &to);
        let get = |n: Option<usize>, o: Option<usize>, els: &Vec<Value>, file: &Value| {
            n.map(|i| els[i].clone()).or_else(|| o.map(|i| elements(file)[i].clone()))
        };
        let a = get(a_new, a_old, &new_els, file)
            .ok_or(format!("{what}: no shape with id \"{from}\" to start from."))?;
        let b = get(b_new, b_old, &new_els, file)
            .ok_or(format!("{what}: no shape with id \"{to}\" to point to."))?;
        let id = pick_id(s(ar, "id"), &what)?;
        let stroke = color(ar, "strokeColor")?.unwrap_or_else(|| STROKE.into());
        let mut el = base("arrow", &id, (0.0, 0.0, 0.0, 0.0), &stroke, "transparent", rng);
        for (k, v) in [
            ("lastCommittedPoint", Value::Null),
            ("startBinding", json!({ "elementId": from, "focus": 0, "gap": 6 })),
            ("endBinding", json!({ "elementId": to, "focus": 0, "gap": 6 })),
            ("startArrowhead", Value::Null),
            ("endArrowhead", json!("arrow")),
            ("elbowed", json!(false)),
        ] {
            el[k] = v;
        }
        route(&mut el, &a, &b);
        for (n, o) in [(a_new, a_old), (b_new, b_old)] {
            match (n, o) {
                (Some(i), _) => push_bound(&mut new_els[i], "arrow", &id),
                (None, Some(i)) => {
                    let e = &mut elements_mut(file)[i];
                    push_bound(e, "arrow", &id);
                    touch(e, rng);
                }
                _ => {}
            }
        }
        if let Some(t) = s(ar, "label").map(str::trim).filter(|t| !t.is_empty()) {
            let tid = pick_id(None, "label")?;
            let mut te = text_element(&tid, (0.0, 0.0), t, 14.0, &stroke, Some(&id), Some(200.0), rng);
            center_label(&mut te, &el);
            push_bound(&mut el, "text", &tid);
            new_els.push(el);
            new_els.push(te);
        } else {
            new_els.push(el);
        }
        added.arrows.push(id);
    }
    elements_mut(file).extend(new_els);
    Ok(added)
}

/// Shapes, text and cards can be arrow ends; arrows, lines and bound text can't.
fn is_target(e: &Value) -> bool {
    match s(e, "type") {
        Some("arrow" | "line" | "selection") => false,
        Some("text") => s(e, "containerId").is_none(),
        _ => true,
    }
}

// ---- Changing ----

#[derive(Debug)]
pub struct Changed {
    pub changed: Vec<String>,
    pub deleted: Vec<String>,
}

/// Move, resize, relabel or recolor elements, and delete others (with their labels and
/// the arrows connected to them).
pub fn change(file: &mut Value, changes: &[Value], delete: &[String], rng: &Rng) -> Result<Changed, String> {
    if changes.is_empty() && delete.is_empty() {
        return Err("Give \"changes\" or \"delete\".".into());
    }
    let mut report = Changed { changed: vec![], deleted: vec![] };
    let index_of = |file: &Value, id: &str| {
        elements(file).iter().position(|e| live(e) && s(e, "id") == Some(id))
    };
    for (i, ch) in changes.iter().enumerate() {
        let what = format!("changes[{i}]");
        let asked = s(ch, "id").ok_or(format!("{what} needs \"id\"."))?;
        let mut at = index_of(file, asked).ok_or(format!("{what}: nothing on the canvas has the id \"{asked}\". Use read_canvas for the ids."))?;
        // A label's id stands for its shape or arrow.
        if let Some(c) = s(&elements(file)[at], "containerId").map(str::to_string) {
            if let Some(ci) = index_of(file, &c) {
                at = ci;
            }
        }
        let id = s(&elements(file)[at], "id").unwrap_or_default().to_string();
        let kind = s(&elements(file)[at], "type").unwrap_or("").to_string();
        let linear = matches!(kind.as_str(), "arrow" | "line");
        let (x, y) = (number(ch, "x")?, number(ch, "y")?);
        let (w, h) = (size_arg(ch, "width")?, size_arg(ch, "height")?);
        let text = ch.get("text").map(|t| t.as_str().map(str::to_string).ok_or(format!("{what}: \"text\" must be text.")));
        let text = text.transpose()?;
        let stroke = color(ch, "strokeColor")?;
        let bg = color(ch, "backgroundColor")?;
        if linear && (x.is_some() || y.is_some() || w.is_some() || h.is_some()) {
            return Err(format!("{what}: arrows follow the shapes they connect; move those instead (or delete the arrow and add a new one)."));
        }
        if kind == "embeddable" && text.is_some() {
            return Err(format!("{what}: a note card shows its note; edit the note itself to change its text."));
        }
        {
            let e = &mut elements_mut(file)[at];
            if let Some(x) = x { e["x"] = json!(round(x)); }
            if let Some(y) = y { e["y"] = json!(round(y)); }
            if kind == "text" {
                if w.is_some() || h.is_some() {
                    return Err(format!("{what}: text sizes itself; change \"fontSize\" or the text instead."));
                }
            } else {
                if let Some(w) = w { e["width"] = json!(round(w)); }
                if let Some(h) = h { e["height"] = json!(round(h)); }
            }
            if let Some(c) = &stroke { e["strokeColor"] = json!(c); }
            if let Some(c) = &bg { e["backgroundColor"] = json!(c); }
            let font = number(ch, "fontSize")?.map(|n| n.clamp(8.0, 200.0));
            if kind == "text" {
                if let Some(n) = font { e["fontSize"] = json!(n); }
                if let Some(t) = &text {
                    if t.trim().is_empty() {
                        return Err(format!("{what}: to remove text, delete it."));
                    }
                    e["text"] = json!(t);
                    e["originalText"] = json!(t);
                }
                if font.is_some() || text.is_some() {
                    let (tw, th) = text_size(s(e, "text").unwrap_or(""), f(e, "fontSize").max(8.0), None);
                    e["width"] = json!(tw);
                    e["height"] = json!(th);
                    e["customData"] = merge_flag(e.get("customData"));
                }
            }
            touch(e, rng);
        }
        // The label: new text, a new color, or recentered after a move or resize.
        if kind != "text" && kind != "embeddable" {
            let container = elements(file)[at].clone();
            let label_id = bound_text(&container);
            let label_at = label_id.as_deref().and_then(|l| index_of(file, l));
            match (label_at, &text) {
                (Some(li), Some(t)) if t.trim().is_empty() => {
                    elements_mut(file).remove(li);
                    let e = &mut elements_mut(file)[if li < at { at - 1 } else { at }];
                    if let Some(b) = e.get_mut("boundElements").and_then(Value::as_array_mut) {
                        b.retain(|b| s(b, "type") != Some("text"));
                    }
                }
                (Some(li), _) => {
                    let max = if linear { 200.0 } else { label_width(&container) };
                    let t = &mut elements_mut(file)[li];
                    if let Some(newt) = &text {
                        t["text"] = json!(newt);
                        t["originalText"] = json!(newt);
                    }
                    if let Some(c) = &stroke { t["strokeColor"] = json!(c); }
                    let (tw, th) = text_size(s(t, "originalText").or(s(t, "text")).unwrap_or(""), f(t, "fontSize").max(8.0), Some(max));
                    t["width"] = json!(tw);
                    t["height"] = json!(th);
                    t["customData"] = merge_flag(t.get("customData"));
                    center_label(t, &container);
                    touch(t, rng);
                }
                (None, Some(t)) if !t.trim().is_empty() => {
                    let tid = new_id(rng);
                    let stroke = s(&container, "strokeColor").unwrap_or(STROKE).to_string();
                    let (size, max) = if linear { (14.0, 200.0) } else { (16.0, label_width(&container)) };
                    let mut te = text_element(&tid, (0.0, 0.0), t, size, &stroke, Some(&id), Some(max), rng);
                    center_label(&mut te, &container);
                    push_bound(&mut elements_mut(file)[at], "text", &tid);
                    elements_mut(file).push(te);
                }
                _ => {}
            }
        }
        if x.is_some() || y.is_some() || w.is_some() || h.is_some() {
            reroute(file, &id, rng);
        }
        report.changed.push(id);
    }

    for asked in delete {
        let Some(at) = index_of(file, asked) else {
            return Err(format!("Nothing on the canvas has the id \"{asked}\" to delete. Use read_canvas for the ids."));
        };
        let e = &elements(file)[at];
        let target = s(e, "containerId")
            .filter(|c| index_of(file, c).is_some())
            .map(str::to_string)
            .unwrap_or_else(|| asked.clone());
        let mut gone: HashSet<String> = HashSet::from([target.clone()]);
        // Arrows connected to it go too.
        for el in elements(file).iter().filter(|e| live(e)) {
            let ends = ["startBinding", "endBinding"]
                .iter()
                .any(|k| el.get(*k).and_then(|b| s(b, "elementId")) == Some(target.as_str()));
            if ends {
                gone.insert(s(el, "id").unwrap_or_default().to_string());
            }
        }
        // And every label inside what goes.
        let labels: Vec<String> = elements(file)
            .iter()
            .filter(|e| s(e, "containerId").is_some_and(|c| gone.contains(c)))
            .filter_map(|e| s(e, "id").map(str::to_string))
            .collect();
        gone.extend(labels);
        elements_mut(file).retain(|e| !s(e, "id").is_some_and(|id| gone.contains(id)));
        // Shapes that pointed at a removed arrow forget it.
        for e in elements_mut(file).iter_mut() {
            let Some(b) = e.get_mut("boundElements").and_then(Value::as_array_mut) else { continue };
            let before = b.len();
            b.retain(|x| !s(x, "id").is_some_and(|id| gone.contains(id)));
            if b.len() != before {
                touch(e, rng);
            }
        }
        let mut gone: Vec<String> = gone.into_iter().collect();
        gone.sort();
        report.deleted.extend(gone);
    }
    report.deleted.sort();
    report.deleted.dedup();
    Ok(report)
}

fn merge_flag(custom: Option<&Value>) -> Value {
    let mut m = custom.and_then(Value::as_object).cloned().unwrap_or_default();
    m.insert(REMEASURE.into(), json!(true));
    Value::Object(m)
}

/// Re-route the arrows connected to `id` (and recenter their labels).
fn reroute(file: &mut Value, id: &str, rng: &Rng) {
    let by_id: HashMap<String, Value> = elements(file)
        .iter()
        .filter(|e| live(e))
        .filter_map(|e| Some((s(e, "id")?.to_string(), e.clone())))
        .collect();
    let mut moved: Vec<(String, Value)> = Vec::new();
    for e in elements_mut(file).iter_mut().filter(|e| live(e)) {
        if !matches!(s(e, "type"), Some("arrow" | "line")) {
            continue;
        }
        let end = |k: &str| e.get(k).and_then(|b| s(b, "elementId")).map(str::to_string);
        let (a, b) = (end("startBinding"), end("endBinding"));
        if a.as_deref() != Some(id) && b.as_deref() != Some(id) {
            continue;
        }
        let (Some(a), Some(b)) = (a.and_then(|a| by_id.get(&a)), b.and_then(|b| by_id.get(&b))) else {
            continue;
        };
        route(e, a, b);
        touch(e, rng);
        if let Some(l) = bound_text(e) {
            moved.push((l, e.clone()));
        }
    }
    for (label, arrow) in moved {
        if let Some(t) = elements_mut(file).iter_mut().find(|e| s(e, "id") == Some(label.as_str())) {
            center_label(t, &arrow);
            touch(t, rng);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_note(p: &str) -> Result<String, String> {
        Ok(p.to_string())
    }

    fn by_id<'a>(file: &'a Value, id: &str) -> &'a Value {
        elements(file).iter().find(|e| s(e, "id") == Some(id)).unwrap()
    }

    #[test]
    fn added_shapes_are_complete_labelled_and_connected() {
        let rng = SystemRandom::new();
        let mut file = parse("").unwrap();
        let added = add(
            &mut file,
            &[
                json!({ "id": "a", "type": "rectangle", "text": "Prophase" }),
                json!({ "id": "b", "type": "diamond", "text": "Metaphase", "backgroundColor": "#ffec99" }),
                json!({ "type": "text", "text": "Mitosis", "x": 0, "y": -80, "fontSize": 28 }),
                json!({ "type": "noteCard", "note": "School/Biology.md" }),
            ],
            &[json!({ "from": "a", "to": "b", "label": "then" })],
            &ok_note,
            &rng,
        )
        .unwrap();
        assert_eq!(&added.shapes[..2], ["a", "b"]);
        let a = by_id(&file, "a");
        for k in ["seed", "versionNonce", "strokeColor", "fillStyle", "groupIds", "roundness", "updated"] {
            assert!(a.get(k).is_some(), "rectangle lacks {k}");
        }
        let label = by_id(&file, &bound_text(a).unwrap()).clone();
        assert_eq!(label["containerId"], "a");
        assert_eq!(label["text"], "Prophase");
        assert_eq!(label["customData"][REMEASURE], true);
        // Centered on its shape.
        let (cx, cy) = center(a);
        assert!((f(&label, "x") + f(&label, "width") / 2.0 - cx).abs() < 0.2);
        assert!((f(&label, "y") + f(&label, "height") / 2.0 - cy).abs() < 0.2);
        // Placed side by side, not on top of each other.
        let b = by_id(&file, "b");
        assert!(f(b, "x") >= f(a, "x") + f(a, "width"));
        let arrow = by_id(&file, &added.arrows[0]);
        assert_eq!(arrow["startBinding"]["elementId"], "a");
        assert_eq!(arrow["endBinding"]["elementId"], "b");
        let start = f(arrow, "x");
        assert!(start > f(a, "x") + f(a, "width") && start < f(b, "x"), "starts at a's border");
        assert!(a["boundElements"].as_array().unwrap().iter().any(|x| x["id"] == arrow["id"]));
        let card = by_id(&file, &added.shapes[3]);
        assert_eq!((card["type"].clone(), card["link"].clone()), (json!("embeddable"), json!("axis:School/Biology.md")));

        let (list, truncated) = summary(&file);
        assert!(!truncated);
        let kinds: Vec<&str> = list.iter().map(|x| s(x, "type").unwrap()).collect();
        assert_eq!(kinds, ["rectangle", "diamond", "text", "noteCard", "arrow"], "labels fold into their shapes");
        assert_eq!(list[0]["text"], "Prophase");
        assert_eq!(list[1]["backgroundColor"], "#ffec99");
        assert_eq!((list[4]["from"].clone(), list[4]["to"].clone(), list[4]["label"].clone()), (json!("a"), json!("b"), json!("then")));
    }

    #[test]
    fn bad_input_is_refused_with_a_reason() {
        let rng = SystemRandom::new();
        let mut file = parse("").unwrap();
        add(&mut file, &[json!({ "id": "a" })], &[], &ok_note, &rng).unwrap();
        let err = |file: &mut Value, shapes: &[Value], arrows: &[Value]| {
            add(file, shapes, arrows, &ok_note, &rng).err().unwrap()
        };
        assert!(err(&mut file, &[json!({ "id": "a" })], &[]).contains("already used"));
        assert!(err(&mut file, &[json!({ "type": "star" })], &[]).contains("isn't a shape type"));
        assert!(err(&mut file, &[], &[json!({ "from": "a", "to": "zz" })]).contains("no shape with id \"zz\""));
        assert!(err(&mut file, &[json!({ "x": 3 })], &[]).contains("both"));
        assert!(err(&mut file, &[json!({ "type": "text" })], &[]).contains("needs \"text\""));
        assert!(add(&mut file, &[json!({ "type": "noteCard", "note": "Medical/x.md" })], &[], &|_| Err("hidden".into()), &rng).is_err());
        assert!(parse("[1,2]").is_err());
        assert_eq!(elements(&file).len(), 1, "a refused call adds nothing it could fail on afterwards");
    }

    #[test]
    fn moving_resizing_relabelling_and_deleting() {
        let rng = SystemRandom::new();
        let mut file = parse("").unwrap();
        add(
            &mut file,
            &[json!({ "id": "a", "text": "One" }), json!({ "id": "b", "text": "Two" }), json!({ "id": "c", "text": "Three" })],
            &[json!({ "id": "ab", "from": "a", "to": "b", "label": "next" }), json!({ "id": "bc", "from": "b", "to": "c" })],
            &ok_note,
            &rng,
        )
        .unwrap();
        let v0 = by_id(&file, "b")["version"].as_u64().unwrap();
        let label_b = bound_text(by_id(&file, "b")).unwrap();
        change(
            &mut file,
            &[
                json!({ "id": "b", "x": 100, "y": 400, "width": 200 }),
                json!({ "id": "a", "text": "First step", "backgroundColor": "#b2f2bb" }),
                json!({ "id": "bc", "text": "after" }),
            ],
            &[],
            &rng,
        )
        .unwrap();
        let b = by_id(&file, "b");
        assert_eq!((f(b, "x"), f(b, "y"), f(b, "width")), (100.0, 400.0, 200.0));
        assert!(b["version"].as_u64().unwrap() > v0, "versions rise so the app's merge takes the change");
        let lb = by_id(&file, &label_b);
        assert!((f(lb, "y") + f(lb, "height") / 2.0 - center(b).1).abs() < 0.2, "the label moved with its shape");
        let ab = by_id(&file, "ab");
        let (_, end) = arrow_ends(ab);
        assert!(end.1 > 390.0, "the arrow follows the moved shape");
        let la = by_id(&file, &bound_text(by_id(&file, "a")).unwrap());
        assert_eq!((la["text"].clone(), la["customData"][REMEASURE].clone()), (json!("First step"), json!(true)));
        assert_eq!(by_id(&file, "a")["backgroundColor"], "#b2f2bb");
        assert!(bound_text(by_id(&file, "bc")).is_some(), "an arrow can get a label");
        assert!(change(&mut file, &[json!({ "id": "ab", "x": 1 })], &[], &rng).unwrap_err().contains("follow"));
        assert!(change(&mut file, &[json!({ "id": "nope" })], &[], &rng).unwrap_err().contains("nothing"));

        let done = change(&mut file, &[], &["b".to_string()], &rng).unwrap();
        assert!(done.deleted.contains(&"ab".to_string()) && done.deleted.contains(&"bc".to_string()));
        assert!(done.deleted.contains(&label_b));
        let ids: Vec<&str> = elements(&file).iter().filter_map(|e| s(e, "id")).collect();
        assert!(!ids.contains(&"b") && !ids.contains(&"ab") && !ids.contains(&"bc"));
        let a = by_id(&file, "a");
        assert!(a["boundElements"].as_array().unwrap().iter().all(|x| x["type"] == "text"), "a forgets the deleted arrow");
    }
}
