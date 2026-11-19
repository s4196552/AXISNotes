import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { splitFrontmatter } from "../../lib/markdown";
import { PAGE_STYLE_PROP } from "../templates/templates";

// Paper page styles (frontmatter `axis-style`, editor.css): keep the writing on the paper.
//
// CSS makes every text line a whole number of rows (--paper-row). Images, tables, block
// math, embeds and the properties chip have their own heights, so `paperRhythm` pads each
// one up to the next row; text after them stays on the lines. On Cornell pages
// `cornellZones` puts the Cues section and side headings in the cue column, notes to the
// right of the margin, and the Summary below a rule across the page.

/** The note's `axis-style`, read from its frontmatter. */
export function docPageStyle(state: EditorState): string {
  const head = state.sliceDoc(0, Math.min(state.doc.length, 4000));
  if (!head.startsWith("---")) return "plain";
  const style = splitFrontmatter(head).props[PAGE_STYLE_PROP];
  return typeof style === "string" ? style : "plain";
}

export type CornellZone = "cue" | "notes" | "summary";

export interface CornellLayout {
  /** Zone of each line (index 0 = line 1), or null for frontmatter. */
  zones: (CornellZone | null)[];
  /** Start of the Summary heading's line, or -1 when there is none. */
  summaryFrom: number;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CUES = /^(cues?|cue column|questions|keywords)$/i;
const NOTES = /^notes?$/i;
const SUMMARY = /^summary$/i;

const sectionName = (title: string) =>
  title
    .replace(/[*_`=]/g, "")
    .replace(/:$/, "")
    .trim();

/**
 * Cornell zones by line. Writing starts in the notes column; a "Cues" heading switches
 * to the cue column and a "Notes" heading back; from the "Summary" heading on the
 * writing spans the page. Other headings among the notes sit in the cue column beside
 * them, as cues. Headings inside fenced code are text.
 */
export function cornellLayout(state: EditorState): CornellLayout {
  const doc = state.doc;
  const fmEnd = splitFrontmatter(state.sliceDoc(0, Math.min(doc.length, 20_000))).length;
  const zones: (CornellZone | null)[] = [];
  let zone: CornellZone = "notes";
  let fence: string | null = null;
  let summaryFrom = -1;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from < fmEnd) {
      zones.push(null);
      continue;
    }
    const text = line.text;
    const f = FENCE.exec(text);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      zones.push(zone);
      continue;
    }
    if (f) {
      fence = f[1]!;
      zones.push(zone);
      continue;
    }
    const h = zone === "summary" ? null : HEADING.exec(text);
    if (h) {
      const name = sectionName(h[2]!);
      if (SUMMARY.test(name)) {
        zone = "summary";
        summaryFrom = line.from;
      } else if (CUES.test(name)) zone = "cue";
      else if (NOTES.test(name)) zone = "notes";
      else if (zone === "notes") {
        zones.push("cue");
        continue;
      }
    }
    zones.push(zone);
  }
  return { zones, summaryFrom };
}

const zoneMarks: Record<CornellZone, Decoration> = {
  cue: Decoration.line({ class: "cm-cornell-cue" }),
  notes: Decoration.line({ class: "cm-cornell-notes" }),
  summary: Decoration.line({ class: "cm-cornell-summary" }),
};

interface CornellState {
  layout: CornellLayout | null;
  decorations: DecorationSet;
}

function buildCornell(state: EditorState): CornellState {
  if (docPageStyle(state) !== "cornell") return { layout: null, decorations: Decoration.none };
  const layout = cornellLayout(state);
  const b = new RangeSetBuilder<Decoration>();
  layout.zones.forEach((zone, i) => {
    if (zone) {
      const from = state.doc.line(i + 1).from;
      b.add(from, from, zoneMarks[zone]);
    }
  });
  return { layout, decorations: b.finish() };
}

export const cornellZones = StateField.define<CornellState>({
  create: buildCornell,
  update: (value, tr) => (tr.docChanged ? buildCornell(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** Round `bottom` up to the next row boundary, ignoring sub-pixel error. */
export function rowPad(bottom: number, row: number): number {
  const rem = ((bottom % row) + row) % row;
  return rem < 0.5 || row - rem < 0.5 ? 0 : row - rem;
}

const PAD = "paperPad";
const BASE = "paperBase";
/** Measure passes in a row that changed padding; a cap so layouts that never settle stop. */
const MAX_PASSES = 4;

interface Plan {
  paper: boolean;
  pads: [HTMLElement, number][];
  cornellEnd: string;
}

const padOf = (el: HTMLElement) => Number(el.dataset[PAD] ?? 0);

/** The widget inside a text line that sets its height (an image in a list item, say). */
function tallestWidget(line: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bottom = -Infinity;
  for (const el of line.querySelectorAll<HTMLElement>('[contenteditable="false"]')) {
    if (el.parentElement?.closest('[contenteditable="false"]')) continue;
    const pos = getComputedStyle(el).position;
    if (pos === "absolute" || pos === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > bottom) {
      bottom = r.bottom;
      best = el;
    }
  }
  return best;
}

class PaperRhythm {
  passes = 0;

  constructor(readonly view: EditorView) {
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.passes = 0;
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged) this.schedule();
  }

  schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => this.read(view),
      write: (plan, view) => this.write(plan, view),
    });
  }

  read(view: EditorView): Plan {
    const content = view.contentDOM;
    const paper = !!view.dom.closest(".page-paper");
    const pads: [HTMLElement, number][] = [];
    let cornellEnd = "";
    if (!paper) {
      for (const el of content.querySelectorAll<HTMLElement>("[data-paper-pad]"))
        pads.push([el, 0]);
      return { paper, pads, cornellEnd };
    }
    const style = getComputedStyle(content);
    const row = parseFloat(style.getPropertyValue("--paper-row")) || 26;
    const origin = content.getBoundingClientRect().top + parseFloat(style.paddingTop);
    let shift = 0;
    for (const child of content.children) {
      if (!(child instanceof HTMLElement) || child.classList.contains("cm-gap")) continue;
      const r = child.getBoundingClientRect();
      if (r.height === 0) continue;
      let target: HTMLElement | null = child;
      let bottom = r.bottom;
      if (child.classList.contains("cm-line")) {
        // Text lines are whole rows already (editor.css); only a tall widget can break that.
        target = r.height > row + 0.5 ? tallestWidget(child) : null;
        if (!target) continue;
      } else {
        bottom -= padOf(child);
      }
      const applied = padOf(target);
      const natural = bottom - origin + shift - (target === child ? 0 : applied);
      const pad = rowPad(natural, row);
      shift += pad - applied;
      if (Math.abs(pad - applied) > 0.25) pads.push([target, pad]);
    }
    const summary = view.state.field(cornellZones, false)?.layout?.summaryFrom ?? -1;
    if (summary >= 0) cornellEnd = `${view.lineBlockAt(summary).top + shift}px`;
    return { paper, pads, cornellEnd };
  }

  write(plan: Plan, view: EditorView) {
    if (plan.cornellEnd !== view.scrollDOM.style.getPropertyValue("--cornell-end")) {
      if (plan.cornellEnd) view.scrollDOM.style.setProperty("--cornell-end", plan.cornellEnd);
      else view.scrollDOM.style.removeProperty("--cornell-end");
    }
    if (!plan.pads.length) return;
    if (plan.paper && ++this.passes > MAX_PASSES) return;
    for (const [el, pad] of plan.pads) {
      // Block widgets grow by padding (part of the height CodeMirror records); a widget
      // inside a text line by margin, which the line's own height takes in.
      const prop =
        el.classList.contains("cm-line") || el.parentElement !== view.contentDOM
          ? "marginBottom"
          : "paddingBottom";
      if (!(BASE in el.dataset)) {
        el.dataset[BASE] = el.style[prop];
        el.style[prop] = "";
        el.dataset[BASE + "Px"] = String(parseFloat(getComputedStyle(el)[prop]) || 0);
      }
      if (pad === 0) {
        el.style[prop] = el.dataset[BASE] ?? "";
        delete el.dataset[PAD];
        delete el.dataset[BASE];
        delete el.dataset[BASE + "Px"];
      } else {
        el.dataset[PAD] = String(pad);
        el.style[prop] = `${Number(el.dataset[BASE + "Px"]) + pad}px`;
      }
    }
  }
}

export const paperRhythm = ViewPlugin.fromClass(PaperRhythm);

export const paperLayout: Extension = [cornellZones, paperRhythm];
