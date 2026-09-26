import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { normalizeWord, proseWords, type WordRange } from "../../lib/spelling";
import type { Speller } from "./engine";

// Offline spellcheck for the Markdown editor: misspelled prose words in the visible part
// of the note get a wavy underline. Right-click one (or Ctrl+. on it) for quick fixes:
// suggestions, "Add to dictionary" (the vault's personal word list), or "Ignore" (for
// this session).

export interface SpellcheckOptions {
  speller: Speller;
  /** Words in the personal dictionary (lower-cased). */
  isKnown(word: string): boolean;
  addWord(word: string): void;
}

/** Re-run the check (e.g. after the personal dictionary changed). */
export const recheck = StateEffect.define<null>();
const redraw = StateEffect.define<null>();

/** Words ignored for this session, lower-cased. */
const ignored = new Set<string>();

/** Syntax nodes whose text is not prose. */
const SKIP_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLBlock",
  "HTMLTag",
  "CommentBlock",
  "Comment",
  "ProcessingInstructionBlock",
  "LinkReference",
]);

/** End of the YAML frontmatter block, or 0. */
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, 500); n++) {
    const line = doc.line(n);
    if (line.text === "---" || line.text === "...") return line.to;
  }
  return 0;
}

/** Prose words in the visible part of the editor. */
function visibleWords(view: EditorView): WordRange[] {
  const { state } = view;
  const fm = frontmatterEnd(state);
  const tree = syntaxTree(state);
  const out: WordRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    const skip: [number, number][] = [];
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!SKIP_NODES.has(node.name)) return;
        skip.push([node.from, node.to]);
        return false;
      },
    });
    let pos = Math.max(from, fm);
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const lineSkip = skip.filter(([a, b]) => a < line.to && b > line.from);
      out.push(...proseWords(line.text, line.from, lineSkip));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return out;
}

const misspelled = Decoration.mark({ class: "cm-misspelled" });

const options = Facet.define<SpellcheckOptions, SpellcheckOptions | null>({
  combine: (v) => v[0] ?? null,
});

const spellPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    /** Normalized word → spelled correctly. */
    cache = new Map<string, boolean>();
    timer: ReturnType<typeof setTimeout> | undefined;
    destroyed = false;
    typedAt = 0;

    constructor(readonly view: EditorView) {
      this.schedule(0);
    }

    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.decorations = this.decorations.map(u.changes);
        this.typedAt = Date.now();
      }
      const asked = u.transactions.some((t) => t.effects.some((e) => e.is(recheck)));
      if (u.docChanged || u.viewportChanged || asked) this.schedule(u.docChanged ? 350 : 30);
    }

    schedule(delay: number) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.run(), delay);
    }

    async run() {
      const view = this.view;
      const opts = view.state.facet(options);
      if (!opts) return;
      const doc = view.state.doc;
      const words = visibleWords(view);
      const unknown = [
        ...new Set(words.map((w) => normalizeWord(w.word)).filter((w) => !this.cache.has(w))),
      ];
      if (unknown.length) {
        let result: boolean[];
        try {
          result = await opts.speller.check(unknown);
        } catch {
          return; // Dictionary failed to load: no underlines.
        }
        unknown.forEach((w, i) => this.cache.set(w, result[i] ?? true));
      }
      if (this.destroyed) return;
      if (view.state.doc !== doc) return this.schedule(200);
      // Don't flag the word being typed right now.
      const head = view.state.selection.main.head;
      const typing = Date.now() - this.typedAt < 1500;
      const bad = words.filter((w) => {
        const norm = normalizeWord(w.word);
        const lower = norm.toLowerCase();
        if (this.cache.get(norm) !== false || ignored.has(lower) || opts.isKnown(lower))
          return false;
        return !(typing && head === w.to);
      });
      this.decorations = Decoration.set(bad.map((w) => misspelled.range(w.from, w.to)));
      view.dispatch({ effects: redraw.of(null) });
    }

    destroy() {
      this.destroyed = true;
      clearTimeout(this.timer);
    }
  },
  { decorations: (p) => p.decorations },
);

// ---- Quick-fix menu ----

interface FixMenu {
  from: number;
  to: number;
  word: string;
  /** null while loading. */
  suggestions: string[] | null;
}

const openFix = StateEffect.define<FixMenu | null>();

function fixTooltip(menu: FixMenu, opts: SpellcheckOptions): Tooltip {
  return {
    pos: menu.from,
    above: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-spell-menu";
      dom.setAttribute("role", "menu");
      dom.setAttribute("aria-label", `Spelling: ${menu.word}`);
      const close = () => {
        view.dispatch({ effects: openFix.of(null) });
        view.focus();
      };
      const item = (label: string, run: () => void, cls = "") => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.className = cls;
        b.textContent = label;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", run);
        dom.appendChild(b);
        return b;
      };
      if (menu.suggestions === null) {
        const s = document.createElement("div");
        s.className = "cm-spell-note";
        s.textContent = "Looking for suggestions…";
        dom.appendChild(s);
      } else if (menu.suggestions.length === 0) {
        const s = document.createElement("div");
        s.className = "cm-spell-note";
        s.textContent = "No suggestions";
        dom.appendChild(s);
      }
      for (const s of menu.suggestions ?? []) {
        item(
          s,
          () => {
            view.dispatch({
              changes: { from: menu.from, to: menu.to, insert: s },
              selection: { anchor: menu.from + s.length },
              effects: openFix.of(null),
            });
            view.focus();
          },
          "cm-spell-suggestion",
        );
      }
      const sep = document.createElement("hr");
      dom.appendChild(sep);
      item(`Add “${menu.word}” to dictionary`, () => {
        opts.addWord(normalizeWord(menu.word).toLowerCase());
        close();
      });
      item("Ignore", () => {
        ignored.add(normalizeWord(menu.word).toLowerCase());
        view.dispatch({ effects: [openFix.of(null), recheck.of(null)] });
        view.focus();
      });
      dom.addEventListener("keydown", (e) => {
        const items = [...dom.querySelectorAll<HTMLButtonElement>("button")];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          items[(at + step + items.length) % items.length]?.focus();
        }
      });
      return {
        dom,
        mount: () => dom.querySelector<HTMLButtonElement>("button")?.focus(),
      };
    },
  };
}

const menuField = StateField.define<FixMenu | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(openFix)) value = e.value;
    if (value && tr.docChanged && !tr.effects.some((e) => e.is(openFix))) return null;
    return value;
  },
  provide: (f) =>
    showTooltip.compute([f, options], (state) => {
      const menu = state.field(f);
      const opts = state.facet(options);
      return menu && opts ? fixTooltip(menu, opts) : null;
    }),
});

/** Open the quick-fix menu for the misspelled word at `pos`. Returns false if none. */
export function openSpellFix(view: EditorView, pos: number): boolean {
  const opts = view.state.facet(options);
  const decorations = view.plugin(spellPlugin)?.decorations;
  if (!opts || !decorations) return false;
  let hit: { from: number; to: number } | null = null;
  decorations.between(pos, pos, (from, to) => {
    hit = { from, to };
    return false;
  });
  if (!hit) return false;
  const { from, to } = hit;
  const word = view.state.sliceDoc(from, to);
  view.dispatch({ effects: openFix.of({ from, to, word, suggestions: null }) });
  void opts.speller
    .suggest(normalizeWord(word))
    .catch(() => [])
    .then((suggestions) => {
      const open = view.state.field(menuField, false);
      if (open?.from === from && open.word === word)
        view.dispatch({ effects: openFix.of({ from, to, word, suggestions }) });
    });
  return true;
}

/** Spellcheck for a Markdown editor. */
export function spellcheck(opts: SpellcheckOptions): Extension {
  return [
    options.of(opts),
    spellPlugin,
    menuField,
    keymap.of([
      {
        key: "Mod-.",
        run: (view) => {
          const { head } = view.state.selection.main;
          return openSpellFix(view, head) || (head > 0 && openSpellFix(view, head - 1));
        },
      },
    ]),
    EditorView.domEventHandlers({
      contextmenu(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null || !openSpellFix(view, pos)) return false;
        e.preventDefault();
        return true;
      },
    }),
  ];
}
