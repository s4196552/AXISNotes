import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { tokenizeInline } from "../../lib/inlineMarkdown";
import {
  formatTable,
  parseTable,
  tableCellSource,
  type MarkdownTable,
} from "../../lib/markdownTables";
import { linkHost } from "./links";

const controllers = new WeakMap<HTMLElement, TableController>();
const showSource = StateEffect.define<{ from: number; to: number } | null>();
const sourceTable = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    if (value)
      value = { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    for (const effect of tr.effects) if (effect.is(showSource)) value = effect.value;
    if (value && !tr.state.selection.ranges.some((r) => r.from <= value!.to && r.to >= value!.from))
      return null;
    return value;
  },
});

function inline(parent: HTMLElement, source: string, view: EditorView) {
  for (const token of tokenizeInline(source.replace(/\\\|/g, "|"))) {
    if (token.kind === "text") {
      // Tables commonly use <br> for multiline cells; never interpret arbitrary HTML.
      token.text.split(/<br\s*\/?\s*>/i).forEach((part, i) => {
        if (i) parent.append(document.createElement("br"));
        parent.append(document.createTextNode(part));
      });
      continue;
    }
    if (token.kind === "wikilink") {
      const button = document.createElement("button");
      button.className = "cm-table-link";
      button.textContent = token.text;
      button.addEventListener("click", () => view.state.facet(linkHost).openLink(token.inner));
      parent.append(button);
    } else if (token.kind === "link" && /^(https?:|mailto:)/i.test(token.url)) {
      const a = document.createElement("a");
      a.href = token.url;
      a.textContent = token.text;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      parent.append(a);
    } else {
      const tag =
        token.kind === "code"
          ? "code"
          : token.kind === "bold"
            ? "strong"
            : token.kind === "italic"
              ? "em"
              : token.kind === "strike"
                ? "s"
                : "span";
      const element = document.createElement(tag);
      element.textContent = token.text;
      parent.append(element);
    }
  }
}

class TableController {
  editing = false;
  constructor(
    public widget: TableWidget,
    readonly root: HTMLElement,
    readonly view: EditorView,
  ) {
    this.render();
  }
  update(widget: TableWidget) {
    const previous = this.widget;
    this.widget = widget;
    if (
      this.editing &&
      previous.table.rows.length === widget.table.rows.length &&
      previous.table.alignment.length === widget.table.alignment.length &&
      previous.readOnly === widget.readOnly
    ) {
      this.root.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((input) => {
        const value = widget.table.rows[Number(input.dataset.row)]![Number(input.dataset.column)]!;
        // Keep the caret during typing, but show undo/redo and external changes even
        // when this cell still has focus.
        if (tableCellSource(input.value) !== value) input.value = value;
      });
    } else this.render();
  }
  change(edit: (table: MarkdownTable) => void) {
    if (this.view.state.readOnly) return;
    const start = this.view.state.doc.lineAt(this.view.posAtDOM(this.root)).from;
    const end = start + this.widget.source.length;
    // A widget must never apply its edits to a different or externally changed table.
    if (this.view.state.sliceDoc(start, end) !== this.widget.source) return;
    const next = structuredClone(this.widget.table);
    edit(next);
    const insert = formatTable(next);
    if (insert !== this.widget.source)
      this.view.dispatch({ changes: { from: start, to: end, insert } });
  }
  render() {
    const { table, readOnly } = this.widget;
    const toolbar = document.createElement("div");
    toolbar.className = "cm-table-tools";
    const action = (label: string, run: () => void, mutation = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = mutation && readOnly;
      button.addEventListener("click", () => {
        run();
        if (
          !button.isConnected &&
          this.root.isConnected &&
          !this.root.contains(document.activeElement)
        )
          this.root.querySelector("button")?.focus();
      });
      toolbar.append(button);
    };
    action(
      this.editing ? "Done editing" : "Edit cells",
      () => {
        this.editing = !this.editing;
        this.render();
        if (this.editing) this.root.querySelector("textarea")?.focus();
        else this.root.querySelector("button")?.focus();
        this.view.requestMeasure();
      },
      true,
    );
    action("Format table", () => this.change(() => {}), true);
    action("Edit Markdown", () => {
      const start = this.view.state.doc.lineAt(this.view.posAtDOM(this.root)).from;
      this.view.dispatch({
        effects: showSource.of({ from: start, to: start + this.widget.source.length }),
        selection: { anchor: start },
      });
      this.view.focus();
    });
    if (this.editing) {
      action("Add row", () => this.change((t) => t.rows.push(t.alignment.map(() => ""))), true);
      action(
        "Add column",
        () =>
          this.change((t) => {
            t.alignment.push(null);
            t.rows.forEach((row) => row.push(""));
          }),
        true,
      );
    }
    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    const element = document.createElement("table");
    element.setAttribute("aria-label", "Markdown table");
    const head = element.createTHead();
    const body = element.createTBody();
    table.rows.forEach((row, r) => {
      const tr = (r === 0 ? head : body).insertRow();
      row.forEach((value, c) => {
        const cell = document.createElement(r === 0 ? "th" : "td");
        if (r === 0) cell.scope = "col";
        cell.style.textAlign = table.alignment[c] ?? "left";
        if (this.editing) {
          const input = document.createElement("textarea");
          input.value = value;
          input.rows = 2;
          input.dataset.row = String(r);
          input.dataset.column = String(c);
          input.setAttribute("aria-label", `${r === 0 ? "Header" : `Row ${r}`}, column ${c + 1}`);
          input.addEventListener("input", () =>
            this.change((t) => {
              t.rows[r]![c] = tableCellSource(input.value);
            }),
          );
          cell.append(input);
          if (r === 0 && table.alignment.length > 1) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove column";
            remove.setAttribute("aria-label", `Remove column ${c + 1}`);
            remove.addEventListener("click", () =>
              this.change((t) => {
                t.alignment.splice(c, 1);
                t.rows.forEach((cells) => cells.splice(c, 1));
              }),
            );
            cell.append(remove);
          }
        } else inline(cell, value, this.view);
        tr.append(cell);
      });
      if (this.editing && r > 0) {
        const cell = tr.insertCell();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove row";
        remove.setAttribute("aria-label", `Remove row ${r}`);
        remove.addEventListener("click", () =>
          this.change((t) => {
            t.rows.splice(r, 1);
          }),
        );
        cell.append(remove);
      }
    });
    scroll.append(element);
    this.root.replaceChildren(toolbar, scroll);
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly table: MarkdownTable,
    readonly readOnly: boolean,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return this.source === other.source && this.readOnly === other.readOnly;
  }
  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "cm-markdown-table";
    root.contentEditable = "false";
    controllers.set(root, new TableController(this, root, view));
    return root;
  }
  updateDOM(dom: HTMLElement) {
    const controller = controllers.get(dom);
    if (!controller) return false;
    controller.update(this);
    return true;
  }
  ignoreEvent() {
    return true;
  }
}

class SourceTableWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "cm-table-tools";
    root.contentEditable = "false";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show table";
    button.title = "Return to the table preview (Escape)";
    button.addEventListener("click", () => view.dispatch({ effects: showSource.of(null) }));
    root.append(button);
    return root;
  }
  ignoreEvent() {
    return true;
  }
}

export function tableDecorations(state: EditorState): DecorationSet {
  if (!state.doc.toString().includes("|")) return Decoration.none;
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  const out: Range<Decoration>[] = [];
  for (let n = 1; n < state.doc.lines; n++) {
    const first = state.doc.line(n);
    if (!first.text.includes("|") || /^ {4}|^\t/.test(first.text)) continue;
    let excluded = false;
    for (let node = tree.resolveInner(first.from, 1); node; node = node.parent!) {
      if (/^(FencedCode|CodeBlock|Frontmatter|HTMLBlock)$/.test(node.name)) excluded = true;
    }
    if (excluded) continue;
    const lines = [first.text, state.doc.line(n + 1).text];
    if (!parseTable(lines)) continue;
    let last = n + 1;
    while (last < state.doc.lines) {
      const text = state.doc.line(last + 1).text;
      if (!text.trim() || !text.includes("|") || /^\s*(`{3,}|~{3,}|>)/.test(text)) break;
      lines.push(text);
      last++;
    }
    const end = state.doc.line(last).to;
    const source = state.field(sourceTable, false);
    if (!source || source.from !== first.from) {
      const source = state.sliceDoc(first.from, end);
      out.push(
        Decoration.replace({
          widget: new TableWidget(source, parseTable(lines)!, state.readOnly),
          block: true,
        }).range(first.from, end),
      );
    } else {
      out.push(
        Decoration.widget({ widget: new SourceTableWidget(), block: true, side: -1 }).range(
          first.from,
        ),
      );
    }
    n = last;
  }
  return Decoration.set(out);
}

const tableField = StateField.define<DecorationSet>({
  create: tableDecorations,
  update: (value, tr) =>
    tr.docChanged || tr.selection || tr.reconfigured || tr.effects.some((e) => e.is(showSource))
      ? tableDecorations(tr.state)
      : value,
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
export const tables = [
  sourceTable,
  tableField,
  keymap.of([
    {
      key: "Escape",
      run(view) {
        if (!view.state.field(sourceTable)) return false;
        view.dispatch({ effects: showSource.of(null) });
        return true;
      },
    },
  ]),
];
