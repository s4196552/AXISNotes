import { CARD_PREFIX, type CanvasElement } from "../../lib/canvas";
import { extractJson, InvalidAnswer } from "../../lib/aiJson";
import { arrayAfter } from "../../lib/diagram";
import { REMEASURE } from "./liveMerge";

// AI drawing on an open canvas from the sidebar chat (T-295). The model answers with a list
// of operations in the same shapes as the connector's canvas tools (`add_to_canvas` and
// `change_canvas` in src-tauri/src/mcp/canvas.rs): add labelled shapes, text, note cards and
// arrows by id, change elements by id, delete them. This is the TypeScript twin of that Rust
// code, so a drawing behaves the same whichever way it arrives. Text sizes are estimates
// flagged with `customData.axisRemeasure`; the canvas measures them with the real font.

export type El = CanvasElement & { id: string; type: string };
/** One operation as the model wrote it (checked when applied). */
export type DrawOp = Record<string, unknown>;

export interface DrawAnswer {
  ops: DrawOp[];
  /** A sentence or two for the chat. */
  reply: string;
}

export interface ApplyOptions {
  /** The path a note card may show for `asked`, or an error message (missing or kept from AI). */
  noteOk(asked: string): { path: string } | { error: string };
  /**
   * The id to give what the model didn't name (labels, shapes without an id), by a key that
   * is the same each time the same operations are applied, so a redrawn draft keeps its ids.
   */
  idFor?(key: string): string;
}

/** An `idFor` that makes a new id for each key once and then keeps it. */
export function stableIds(): (key: string) => string {
  const ids = new Map<string, string>();
  return (key) => {
    let id = ids.get(key);
    if (!id) ids.set(key, (id = newId()));
    return id;
  };
}

export interface Applied {
  elements: El[];
  /** One line per operation that couldn't be applied (it was skipped). */
  problems: string[];
  added: string[];
  changed: string[];
  deleted: string[];
}

/** The most operations one answer may have. */
export const MAX_OPS = 200;
/** The most elements the chat lists for the model. */
export const MAX_LISTED = 500;

const STROKE = "#1e1e1e";
const FONT_FAMILY = 5; // Excalifont
const LINE_HEIGHT = 1.25;
const CHAR_WIDTH = 0.55;
const PADDING = 5;
const CARD = { width: 320, height: 220 };
const SHAPES = ["rectangle", "ellipse", "diamond"];
const OPS = ["add", "arrow", "change", "delete"];

class Problem extends Error {}

// ---- Small accessors ----

const str = (e: Record<string, unknown>, k: string) =>
  typeof e[k] === "string" ? (e[k] as string) : undefined;
const num = (e: Record<string, unknown>, k: string) =>
  typeof e[k] === "number" && Number.isFinite(e[k]) ? (e[k] as number) : 0;
const live = (e: El) => e.isDeleted !== true;
const round = (x: number) => Math.round(x * 10) / 10;
type Bound = { type?: string; id?: string };
const bounds = (e: El): Bound[] => (Array.isArray(e.boundElements) ? e.boundElements : []);
const boundText = (e: El) => bounds(e).find((b) => b?.type === "text")?.id;
const cardNote = (e: El) => {
  const link = str(e, "link");
  return e.type === "embeddable" && link?.startsWith(CARD_PREFIX)
    ? link.slice(CARD_PREFIX.length)
    : undefined;
};
const endOf = (e: El, k: "startBinding" | "endBinding") => {
  const b = e[k] as { elementId?: unknown } | null | undefined;
  return typeof b?.elementId === "string" ? b.elementId : undefined;
};

const rand31 = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0]! >>> 1;
};

/** A new id in Excalidraw's style (21 URL-safe characters). */
export function newId(): string {
  const abc = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
  const b = new Uint8Array(21);
  crypto.getRandomValues(b);
  return [...b].map((x) => abc[x & 63]).join("");
}

const touch = (e: El): El => ({
  ...e,
  version: (typeof e.version === "number" ? e.version : 1) + 1,
  versionNonce: rand31(),
  updated: Date.now(),
});

// ---- Reading ----

/**
 * The canvas as the model sees it: one entry per live element, labels folded into their
 * shape or arrow, positions rounded (as the connector's `read_canvas`). `showCard` says
 * whether a note card's note path may be shown; hidden ones are listed without it.
 */
export function summarize(
  elements: readonly CanvasElement[],
  showCard: (note: string) => boolean,
): { items: Record<string, unknown>[]; truncated: boolean } {
  const els = (elements as El[]).filter((e) => e && typeof e.id === "string" && live(e));
  const byId = new Map(els.map((e) => [e.id, e]));
  const label = (e: El) => {
    const t = boundText(e);
    const text = t ? str(byId.get(t) ?? {}, "text") : undefined;
    return text?.slice(0, 500);
  };
  const items: Record<string, unknown>[] = [];
  let total = 0;
  for (const e of els) {
    const container = str(e, "containerId");
    if (e.type === "text" && container && byId.has(container)) continue;
    total++;
    if (items.length >= MAX_LISTED) continue;
    const item: Record<string, unknown> = { id: e.id };
    const box = () => {
      for (const k of ["x", "y", "width", "height"]) item[k] = round(num(e, k));
    };
    if (e.type === "arrow" || e.type === "line") {
      item.type = e.type;
      const from = endOf(e, "startBinding");
      const to = endOf(e, "endBinding");
      if (from && byId.has(from)) item.from = from;
      if (to && byId.has(to)) item.to = to;
      const [a, b] = arrowEnds(e);
      item.start = [round(a.x), round(a.y)];
      item.end = [round(b.x), round(b.y)];
      const l = label(e);
      if (l) item.label = l;
    } else if (cardNote(e) !== undefined) {
      const note = cardNote(e)!;
      item.type = "noteCard";
      if (showCard(note)) item.note = note;
      else item.private = true;
      box();
    } else if (e.type === "text") {
      item.type = "text";
      box();
      item.text = (str(e, "text") ?? "").slice(0, 500);
      item.fontSize = num(e, "fontSize");
    } else {
      item.type = e.type;
      box();
      const l = label(e);
      if (l) item.text = l;
    }
    if (["rectangle", "ellipse", "diamond", "text", "arrow", "line"].includes(e.type)) {
      const stroke = str(e, "strokeColor");
      const bg = str(e, "backgroundColor");
      if (stroke && stroke !== STROKE) item.strokeColor = stroke;
      if (bg && bg !== "transparent") item.backgroundColor = bg;
    }
    items.push(item);
  }
  return { items, truncated: total > MAX_LISTED };
}

// ---- The answer ----

/** Parse a finished answer's shape (the operations are checked when applied). */
export function parseDrawAnswer(answer: string): DrawAnswer {
  const value = extractJson(answer);
  const problems: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidAnswer(['the reply must be a JSON object with "ops" and "reply"']);
  const v = value as { ops?: unknown; reply?: unknown };
  if (!Array.isArray(v.ops)) problems.push('"ops" must be an array of operations');
  else {
    if (v.ops.length > MAX_OPS) problems.push(`"ops" can have at most ${MAX_OPS} operations`);
    v.ops.forEach((op: unknown, i) => {
      const kind = op && typeof op === "object" ? (op as DrawOp).op : undefined;
      if (typeof kind !== "string" || !OPS.includes(kind))
        problems.push(`ops[${i}].op must be one of "add", "arrow", "change", "delete"`);
    });
  }
  if (v.reply !== undefined && typeof v.reply !== "string")
    problems.push('"reply" must be a string');
  if (problems.length) throw new InvalidAnswer(problems);
  return { ops: v.ops as DrawOp[], reply: typeof v.reply === "string" ? v.reply.trim() : "" };
}

/** The complete operations of an answer still arriving, and its reply so far. */
export function partialDraw(answer: string): DrawAnswer {
  const ops = arrayAfter(answer, "ops")
    .filter(
      (op): op is DrawOp =>
        !!op && typeof op === "object" && OPS.includes((op as DrawOp).op as string),
    )
    .slice(0, MAX_OPS);
  let reply = "";
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(answer);
  if (m) {
    try {
      reply = JSON.parse(`"${m[1]!.replace(/\\$/, "")}"`) as string;
    } catch {
      reply = "";
    }
  }
  return { ops, reply };
}

// ---- Building elements ----

function base(kind: string, id: string, box: number[], stroke: string, bg: string): El {
  const roundness =
    kind === "rectangle" || kind === "embeddable"
      ? { type: 3 }
      : ["arrow", "line", "diamond", "ellipse"].includes(kind)
        ? { type: 2 }
        : null;
  return {
    id,
    type: kind,
    x: box[0],
    y: box[1],
    width: box[2],
    height: box[3],
    angle: 0,
    strokeColor: stroke,
    backgroundColor: bg,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness,
    seed: rand31(),
    version: 1,
    versionNonce: rand31(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function wrappedLines(text: string, maxChars: number): string[] {
  const max = Math.max(1, maxChars);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line.length > 0 && line.length + 1 + word.length > max) {
        out.push(line);
        line = "";
      }
      line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

function textSize(text: string, size: number, maxWidth?: number) {
  const lines =
    maxWidth !== undefined
      ? wrappedLines(text, Math.floor(maxWidth / (size * CHAR_WIDTH)))
      : text.split("\n");
  const longest = Math.max(0, ...lines.map((l) => l.length));
  let w = Math.max(Math.ceil(longest * size * CHAR_WIDTH), size * 0.5);
  if (maxWidth !== undefined) w = Math.min(w, maxWidth);
  return { width: w, height: Math.ceil(lines.length * size * LINE_HEIGHT) };
}

function textElement(
  id: string,
  text: string,
  size: number,
  stroke: string,
  container: string | null,
  maxWidth?: number,
): El {
  const { width, height } = textSize(text, size, maxWidth);
  const centered = container !== null;
  return {
    ...base("text", id, [0, 0, width, height], stroke, "transparent"),
    text,
    originalText: text,
    fontSize: size,
    fontFamily: FONT_FAMILY,
    textAlign: centered ? "center" : "left",
    verticalAlign: centered ? "middle" : "top",
    containerId: container,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    customData: { [REMEASURE]: true },
    boundElements: null,
  };
}

function labelWidth(c: El) {
  const w = num(c, "width");
  const inner = c.type === "ellipse" ? w * Math.SQRT1_2 : c.type === "diamond" ? w / 2 : w;
  return Math.max(inner - 2 * PADDING, 20);
}

const center = (e: El) => ({
  x: num(e, "x") + num(e, "width") / 2,
  y: num(e, "y") + num(e, "height") / 2,
});

function arrowEnds(e: El) {
  const pts = Array.isArray(e.points) ? (e.points as number[][]) : [];
  const at = (p?: number[]) => ({ x: num(e, "x") + (p?.[0] ?? 0), y: num(e, "y") + (p?.[1] ?? 0) });
  return [at(pts[0]), at(pts.at(-1))] as const;
}

function centerLabel(text: El, container: El): El {
  let c: { x: number; y: number };
  if (container.type === "arrow" || container.type === "line") {
    const [a, b] = arrowEnds(container);
    c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  } else c = center(container);
  return {
    ...text,
    x: round(c.x - num(text, "width") / 2),
    y: round(c.y - num(text, "height") / 2),
  };
}

function border(box: El, to: { x: number; y: number }) {
  const c = center(box);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const scale = Math.min(
    dx ? num(box, "width") / 2 / Math.abs(dx) : Infinity,
    dy ? num(box, "height") / 2 / Math.abs(dy) : Infinity,
  );
  const gap = 6 / Math.hypot(dx, dy);
  return { x: c.x + dx * (scale + gap), y: c.y + dy * (scale + gap) };
}

function route(arrow: El, a: El, b: El): El {
  const s = border(a, center(b));
  const t = border(b, center(a));
  return {
    ...arrow,
    x: round(s.x),
    y: round(s.y),
    width: round(Math.abs(t.x - s.x)),
    height: round(Math.abs(t.y - s.y)),
    points: [
      [0, 0],
      [round(t.x - s.x), round(t.y - s.y)],
    ],
  };
}

const withBound = (e: El, type: string, id: string): El => ({
  ...e,
  boundElements: [...bounds(e), { type, id }],
});

function color(op: DrawOp, key: string): string | undefined {
  const v = op[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && v.trim() && v.length <= 40) return v.trim();
  throw new Problem(`"${key}" must be a color such as "#1971c2", "red" or "transparent"`);
}

function number(op: DrawOp, key: string): number | undefined {
  const v = op[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7) return v;
  throw new Problem(`"${key}" must be a number`);
}

function sizeArg(op: DrawOp, key: string): number | undefined {
  const n = number(op, key);
  if (n !== undefined && n < 1) throw new Problem(`"${key}" must be at least 1`);
  return n;
}

/** Shapes, text and cards can be arrow ends; arrows, lines and labels can't. */
const isTarget = (e: El) =>
  !["arrow", "line", "selection"].includes(e.type) && !(e.type === "text" && e.containerId);

// ---- Applying ----

/**
 * The scene after `ops`, applied in order to `elements` (which are not changed). Changed and
 * new elements are new objects with higher versions; deleted ones are marked `isDeleted`.
 * An operation that can't be applied is skipped and explained in `problems`.
 */
export function applyOps(
  elements: readonly CanvasElement[],
  ops: readonly DrawOp[],
  opts: ApplyOptions,
): Applied {
  const els: El[] = (elements as El[]).filter((e) => e && typeof e.id === "string");
  const out: Applied = { elements: els, problems: [], added: [], changed: [], deleted: [] };
  const taken = new Set(els.map((e) => e.id));
  const indexOf = (id: string) => els.findIndex((e) => live(e) && e.id === id);
  let opIndex = 0;
  const pickId = (given: unknown, what: string): string => {
    const g = typeof given === "string" ? given.trim() : "";
    if (!g) {
      // The same id each time these operations are applied (drafts redraw from the start).
      const wanted = opts.idFor?.(`${what}:${opIndex}`);
      if (wanted && !taken.has(wanted)) return (taken.add(wanted), wanted);
      for (;;) {
        const id = newId();
        if (!taken.has(id)) return (taken.add(id), id);
      }
    }
    if (g.length > 64 || !/^[A-Za-z0-9\-_.:]+$/.test(g))
      throw new Problem(
        `the ${what} id "${g}" may only use letters, digits and - _ . : (up to 64)`,
      );
    if (taken.has(g))
      throw new Problem(
        `the id "${g}" is already used on this canvas; pick another or leave it out`,
      );
    taken.add(g);
    return g;
  };

  // Where shapes without a position go: a grid to the right of what's there.
  const boxes = els.filter(live);
  let cursor = boxes.length
    ? {
        x: Math.max(...boxes.map((e) => num(e, "x") + num(e, "width"))) + 120,
        y: Math.min(...boxes.map((e) => num(e, "y"))),
      }
    : { x: 0, y: 0 };
  const gridLeft = cursor.x;
  let rowHeight = 0;
  let inRow = 0;

  const add = (op: DrawOp) => {
    const kind = str(op, "type") ?? "rectangle";
    const text = str(op, "text")?.trimEnd() || undefined;
    const stroke = color(op, "strokeColor") ?? STROKE;
    const bg = color(op, "backgroundColor") ?? "transparent";
    const font = Math.min(200, Math.max(8, number(op, "fontSize") ?? (kind === "text" ? 20 : 16)));
    let w = sizeArg(op, "width");
    let h = sizeArg(op, "height");
    if (![...SHAPES, "text", "noteCard"].includes(kind))
      throw new Problem(
        `"${kind}" isn't a shape type; use rectangle, ellipse, diamond, text or noteCard`,
      );
    if (kind === "text" && !text) throw new Problem('it is text, so it needs "text"');
    let note = "";
    if (kind === "noteCard") {
      const asked = str(op, "note");
      if (!asked) throw new Problem('it is a noteCard, so it needs "note" (a note\'s path)');
      const ok = opts.noteOk(asked);
      if ("error" in ok) throw new Problem(ok.error);
      note = ok.path;
    }
    const x = number(op, "x");
    const y = number(op, "y");
    if ((x === undefined) !== (y === undefined))
      throw new Problem('give both "x" and "y", or neither to place it automatically');
    const id = pickId(op.id, "shape");
    let el: El;
    if (SHAPES.includes(kind)) {
      if (w === undefined || h === undefined) {
        const label = text ?? "";
        const grow = kind === "rectangle" ? 1 : 1.6;
        const dw = Math.min(
          420,
          Math.max(120, (Math.min(textSize(label, font).width, 240) + 40) * grow),
        );
        const width = w ?? dw;
        const inner = labelWidth({ id: "", type: kind, width });
        const th = textSize(label, font, inner).height;
        w = width;
        h ??= Math.max((th + 30) * (kind === "rectangle" ? 1 : 1.5), 60);
      }
      el = base(kind, id, [0, 0, w, h], stroke, bg);
    } else if (kind === "text") {
      el = textElement(id, text!, font, stroke, null, w);
    } else {
      el = {
        ...base("embeddable", id, [0, 0, w ?? CARD.width, h ?? CARD.height], STROKE, "transparent"),
        link: `${CARD_PREFIX}${note}`,
        roughness: 0,
      };
    }
    let at: { x: number; y: number };
    if (x !== undefined && y !== undefined) at = { x, y };
    else {
      if (inRow === 4) {
        cursor = { x: gridLeft, y: cursor.y + rowHeight + 60 };
        rowHeight = 0;
        inRow = 0;
      }
      at = cursor;
      cursor = { x: cursor.x + num(el, "width") + 80, y: cursor.y };
      rowHeight = Math.max(rowHeight, num(el, "height"));
      inRow++;
    }
    el = { ...el, x: round(at.x), y: round(at.y) };
    if (text && SHAPES.includes(kind)) {
      const tid = pickId(undefined, "label");
      const te = centerLabel(textElement(tid, text, font, stroke, id, labelWidth(el)), el);
      els.push(withBound(el, "text", tid), te);
    } else els.push(el);
    out.added.push(id);
  };

  const arrow = (op: DrawOp) => {
    const end = (k: "from" | "to") => {
      const v = str(op, k);
      if (!v)
        throw new Problem(`it needs "${k}": the id of a shape (new or already on the canvas)`);
      const i = els.findIndex((e) => live(e) && e.id === v && isTarget(e));
      if (i < 0)
        throw new Problem(
          k === "from"
            ? `no shape with id "${v}" to start from`
            : `no shape with id "${v}" to point to`,
        );
      return i;
    };
    const ai = end("from");
    const bi = end("to");
    const stroke = color(op, "strokeColor") ?? STROKE;
    const id = pickId(op.id, "arrow");
    const a = els[ai]!;
    const b = els[bi]!;
    let el: El = {
      ...base("arrow", id, [0, 0, 0, 0], stroke, "transparent"),
      lastCommittedPoint: null,
      startBinding: { elementId: a.id, focus: 0, gap: 6 },
      endBinding: { elementId: b.id, focus: 0, gap: 6 },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    };
    el = route(el, a, b);
    for (const i of new Set([ai, bi])) els[i] = touch(withBound(els[i]!, "arrow", id));
    const label = str(op, "label")?.trim();
    if (label) {
      const tid = pickId(undefined, "label");
      const te = centerLabel(textElement(tid, label, 14, stroke, id, 200), el);
      els.push(withBound(el, "text", tid), te);
    } else els.push(el);
    out.added.push(id);
  };

  const reroute = (id: string) => {
    const byId = new Map(els.filter(live).map((e) => [e.id, e]));
    els.forEach((e, i) => {
      if (!live(e) || (e.type !== "arrow" && e.type !== "line")) return;
      const a = endOf(e, "startBinding");
      const b = endOf(e, "endBinding");
      if (a !== id && b !== id) return;
      const ea = a ? byId.get(a) : undefined;
      const eb = b ? byId.get(b) : undefined;
      if (!ea || !eb) return;
      const routed = touch(route(e, ea, eb));
      els[i] = routed;
      const l = boundText(routed);
      const li = l ? indexOf(l) : -1;
      if (li >= 0) els[li] = touch(centerLabel(els[li]!, routed));
    });
  };

  const change = (op: DrawOp) => {
    const asked = str(op, "id");
    if (!asked) throw new Problem('it needs "id"');
    let at = indexOf(asked);
    if (at < 0) throw new Problem(`nothing on the canvas has the id "${asked}"`);
    // A label's id stands for its shape or arrow.
    const container = str(els[at]!, "containerId");
    if (container && indexOf(container) >= 0) at = indexOf(container);
    let e = els[at]!;
    const id = e.id;
    const kind = e.type;
    const linear = kind === "arrow" || kind === "line";
    const x = number(op, "x");
    const y = number(op, "y");
    const w = sizeArg(op, "width");
    const h = sizeArg(op, "height");
    const text = op.text === undefined || op.text === null ? undefined : op.text;
    if (text !== undefined && typeof text !== "string") throw new Problem('"text" must be text');
    const stroke = color(op, "strokeColor");
    const bg = color(op, "backgroundColor");
    const font = number(op, "fontSize");
    const fontSize = font === undefined ? undefined : Math.min(200, Math.max(8, font));
    const moved = x !== undefined || y !== undefined || w !== undefined || h !== undefined;
    if (linear && moved)
      throw new Problem(
        "arrows follow the shapes they connect; move those instead (or delete the arrow and add a new one)",
      );
    if (kind === "embeddable" && text !== undefined)
      throw new Problem("a note card shows its note; it can't be given text");
    if (kind === "text" && (w !== undefined || h !== undefined))
      throw new Problem('text sizes itself; change "fontSize" or the text instead');
    if (kind === "text" && text !== undefined && !text.trim())
      throw new Problem("to remove text, delete it");
    e = {
      ...e,
      ...(x !== undefined ? { x: round(x) } : {}),
      ...(y !== undefined ? { y: round(y) } : {}),
      ...(kind !== "text" && w !== undefined ? { width: round(w) } : {}),
      ...(kind !== "text" && h !== undefined ? { height: round(h) } : {}),
      ...(stroke ? { strokeColor: stroke } : {}),
      ...(bg ? { backgroundColor: bg } : {}),
    };
    if (kind === "text" && (fontSize !== undefined || text !== undefined)) {
      const t = text ?? str(e, "text") ?? "";
      const size = fontSize ?? Math.max(num(e, "fontSize"), 8);
      e = {
        ...e,
        text: t,
        originalText: t,
        fontSize: size,
        ...textSize(t, size),
        customData: { ...(e.customData as object | undefined), [REMEASURE]: true },
      };
    }
    els[at] = e = touch(e);
    // The label: new text, a new color, or recentered after a move or resize.
    if (kind !== "text" && kind !== "embeddable") {
      const labelId = boundText(e);
      const li = labelId ? indexOf(labelId) : -1;
      if (li >= 0 && text !== undefined && !text.trim()) {
        els[li] = touch({ ...els[li]!, isDeleted: true });
        els[at] = { ...e, boundElements: bounds(e).filter((b) => b?.type !== "text") };
      } else if (li >= 0) {
        let t = els[li]!;
        if (text !== undefined) t = { ...t, text, originalText: text };
        if (stroke) t = { ...t, strokeColor: stroke };
        const size = textSize(
          str(t, "originalText") ?? str(t, "text") ?? "",
          Math.max(num(t, "fontSize"), 8),
          linear ? 200 : labelWidth(e),
        );
        t = {
          ...t,
          ...size,
          customData: { ...(t.customData as object | undefined), [REMEASURE]: true },
        };
        els[li] = touch(centerLabel(t, e));
      } else if (text?.trim()) {
        const tid = pickId(undefined, "label");
        const te = textElement(
          tid,
          text,
          linear ? 14 : 16,
          str(e, "strokeColor") ?? STROKE,
          id,
          linear ? 200 : labelWidth(e),
        );
        els[at] = withBound(e, "text", tid);
        els.push(centerLabel(te, e));
      }
    }
    if (moved) reroute(id);
    out.changed.push(id);
  };

  const remove = (op: DrawOp) => {
    const asked = str(op, "id");
    if (!asked) throw new Problem('it needs "id"');
    const at = indexOf(asked);
    if (at < 0) throw new Problem(`nothing on the canvas has the id "${asked}" to delete`);
    const container = str(els[at]!, "containerId");
    const target = container && indexOf(container) >= 0 ? container : asked;
    const gone = new Set([target]);
    // Arrows connected to it go too, and every label inside what goes.
    for (const e of els)
      if (live(e) && (endOf(e, "startBinding") === target || endOf(e, "endBinding") === target))
        gone.add(e.id);
    for (const e of els) {
      const c = str(e, "containerId");
      if (live(e) && c && gone.has(c)) gone.add(e.id);
    }
    els.forEach((e, i) => {
      if (!live(e)) return;
      if (gone.has(e.id)) els[i] = touch({ ...e, isDeleted: true });
      else if (bounds(e).some((b) => b?.id && gone.has(b.id)))
        els[i] = touch({ ...e, boundElements: bounds(e).filter((b) => !b?.id || !gone.has(b.id)) });
    });
    out.deleted.push(...[...gone].sort());
  };

  ops.forEach((op, i) => {
    opIndex = i;
    try {
      const kind = op.op;
      if (kind === "add") add(op);
      else if (kind === "arrow") arrow(op);
      else if (kind === "change") change(op);
      else if (kind === "delete") remove(op);
      else throw new Problem('"op" must be "add", "arrow", "change" or "delete"');
    } catch (e) {
      if (!(e instanceof Problem)) throw e;
      out.problems.push(`ops[${i}] (${String(op.op)}): ${e.message}`);
    }
  });
  out.deleted = [...new Set(out.deleted)].sort();
  return out;
}

// ---- Drawing while the answer arrives ----

const versionOf = (e: El) =>
  `${String(e.version)}/${String(e.versionNonce)}/${String(e.isDeleted)}`;

/** Ids of elements in `after` that are new or changed since `before`. */
export function touchedIds(before: readonly CanvasElement[], after: readonly CanvasElement[]) {
  const was = new Map((before as El[]).map((e) => [e.id, versionOf(e)]));
  return new Set((after as El[]).filter((e) => was.get(e.id) !== versionOf(e)).map((e) => e.id));
}

/**
 * The scene to show: `current` (which may have changed since drawing began) with the drawn
 * elements (`drawn`, the ids in `touched`) in place. Elements an earlier draft touched and
 * this one doesn't go back to how they were in `base` (or go, if the draft added them).
 */
export function overlay(
  current: readonly CanvasElement[],
  base: readonly CanvasElement[],
  drawn: readonly CanvasElement[],
  touched: ReadonlySet<string>,
  before: ReadonlySet<string>,
): El[] {
  const drawnById = new Map((drawn as El[]).map((e) => [e.id, e]));
  const baseById = new Map((base as El[]).map((e) => [e.id, e]));
  const out: El[] = [];
  const seen = new Set<string>();
  for (const e of current as El[]) {
    seen.add(e.id);
    if (touched.has(e.id)) out.push(drawnById.get(e.id) ?? e);
    else if (before.has(e.id)) {
      const b = baseById.get(e.id);
      if (b) out.push(b);
    } else out.push(e);
  }
  for (const e of drawn as El[]) if (touched.has(e.id) && !seen.has(e.id)) out.push(e);
  return out;
}

/** "added 6, changed 1, deleted 2" */
export function describeApplied(a: Pick<Applied, "added" | "changed" | "deleted">): string {
  const parts = [
    a.added.length && `added ${a.added.length}`,
    a.changed.length && `changed ${a.changed.length}`,
    a.deleted.length && `deleted ${a.deleted.length}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no changes";
}
