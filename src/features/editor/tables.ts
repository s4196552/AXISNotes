import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { tokenizeInline } from "../../lib/inlineMarkdown";
import {
  formatTable,
  parseTable,
  replaceTableCell,
  tableCellSource,
  type MarkdownTable,
  type TableAlignment,
} from "../../lib/markdownTables";
import {
  alignColumn,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  sortByColumn,
} from "./tableOps";
import { linkHost } from "./links";
import { inlineIconElement, inlineIconTarget } from "./inlineIcons";
import { toggleMarkInText } from "./inlineMarks";
import { TableCellMenu } from "./tableCellMenu";
import { parseMarkdownEmbed } from "../../lib/attachments";

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

/** A cell's Markdown as it reads: icons, links and the same styles as the rest of the note. */
function inline(parent: HTMLElement, source: string, view: EditorView) {
  const text = source.replace(/\\\|/g, "|");
  let last = 0;
  // Inline icons (`![label](<lucide:Rocket>)`, from the `:` menu) draw as icons.
  for (const m of text.matchAll(INLINE_IMAGE)) {
    const image = parseMarkdownEmbed(m[0]);
    const target = image && inlineIconTarget(image.src);
    if (!target) continue;
    inlineText(parent, text.slice(last, m.index), view);
    parent.append(inlineIconElement(target, image.alt || "Icon"));
    last = m.index + m[0].length;
  }
  inlineText(parent, text.slice(last), view);
}

const INLINE_IMAGE = /!\[[^\]\n]*\]\(\s*(?:<[^>\n]+>|[^\s()]+)\s*\)/g;

/** Bold, italic and strikethrough look as they do in the note, with their colours (T-260). */
const STYLE_CLASS: Partial<Record<string, string>> = {
  bold: "cm-lp-strong",
  italic: "cm-lp-em",
  strike: "cm-lp-strike",
};

function inlineText(parent: HTMLElement, text: string, view: EditorView) {
  for (const token of tokenizeInline(text)) {
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
      const style = STYLE_CLASS[token.kind];
      if (style) element.className = style;
      parent.append(element);
    }
  }
}

type MenuItem = { label: string; run: () => void; danger?: boolean } | "separator";

/**
 * A rendered table, edited the way Obsidian's is: click a cell and type (Tab and Enter move
 * on), the + bars at the right and bottom add a column or row, the grips beside a row or
 * above a column open its menu or drag it somewhere else, and right-click offers the same
 * edits for that cell's row and column. Every edit is written straight back as Markdown.
 */
class TableController {
  activeCell: HTMLTableCellElement | null = null;
  menu: HTMLElement | null = null;
  /** The command and emoji menu of the cell being edited. */
  picker: TableCellMenu | null = null;
  constructor(
    public widget: TableWidget,
    readonly root: HTMLElement,
    readonly view: EditorView,
  ) {
    this.render();
    root.addEventListener("mouseover", (e) => this.hover(e.target as HTMLElement));
    root.addEventListener("mouseleave", () => this.hover(null));
  }
  update(widget: TableWidget) {
    const previous = this.widget;
    this.widget = widget;
    if (
      previous.table.rows.length === widget.table.rows.length &&
      previous.table.alignment.length === widget.table.alignment.length &&
      previous.readOnly === widget.readOnly
    ) {
      this.root.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((input) => {
        const value = widget.table.rows[Number(input.dataset.row)]![Number(input.dataset.column)]!;
        // Keep the caret during typing, but show undo/redo and external changes even
        // when this cell still has focus. Parsed values omit edge padding: retain
        // draft spaces so typing the next word does not join it to the previous one.
        if (tableCellSource(input.value).trim() !== value) input.value = value;
      });
      this.root.querySelectorAll<HTMLElement>(".cm-table-cell-preview").forEach((preview) => {
        const cell = preview.parentElement!;
        const row = Number(cell.dataset.row);
        const column = Number(cell.dataset.column);
        const value = widget.table.rows[row]![column]!;
        cell.style.textAlign = widget.table.alignment[column] ?? "left";
        if (previous.table.rows[row]![column] === value) return;
        preview.replaceChildren();
        inline(preview, value, this.view);
      });
    } else {
      // Rows or columns changed: draw again, keeping the cell being edited if it's there.
      const at = this.activeCell && {
        row: Number(this.activeCell.dataset.row),
        column: Number(this.activeCell.dataset.column),
        focused: this.root.contains(document.activeElement),
      };
      this.render();
      if (at?.focused) {
        const cell = this.cellAt(at.row, at.column);
        if (cell) this.activate(cell);
      }
    }
  }
  get table() {
    return this.widget.table;
  }
  cellAt(row: number, column: number) {
    return this.root.querySelector<HTMLTableCellElement>(
      `[data-table-cell][data-row="${row}"][data-column="${column}"]`,
    );
  }
  write(insert: string) {
    if (this.view.state.readOnly) return;
    const start = this.view.state.doc.lineAt(this.view.posAtDOM(this.root)).from;
    const end = start + this.widget.source.length;
    if (this.view.state.sliceDoc(start, end) !== this.widget.source) return;
    if (insert !== this.widget.source)
      this.view.dispatch({ changes: { from: start, to: end, insert } });
  }
  editCell(row: number, column: number, value: string) {
    this.write(replaceTableCell(this.widget.source, row, column, value));
  }
  /** Apply a row/column edit and write the table back. */
  change(edit: (table: MarkdownTable) => MarkdownTable) {
    if (this.view.state.readOnly) return;
    const next = edit(this.widget.table);
    if (next !== this.widget.table) this.write(formatTable(next));
  }
  showSource() {
    const start = this.view.state.doc.lineAt(this.view.posAtDOM(this.root)).from;
    this.view.dispatch({
      effects: showSource.of({ from: start, to: start + this.widget.source.length }),
      selection: { anchor: start },
    });
    this.view.focus();
  }
  finish(cell: HTMLTableCellElement) {
    if (this.activeCell !== cell) return;
    this.activeCell = null;
    this.picker?.close();
    this.picker = null;
    cell.querySelector("textarea")?.remove();
    cell.classList.remove("cm-table-cell-active");
    const preview = cell.querySelector<HTMLElement>(".cm-table-cell-preview")!;
    preview.replaceChildren();
    inline(
      preview,
      this.widget.table.rows[Number(cell.dataset.row)]![Number(cell.dataset.column)]!,
      this.view,
    );
    this.view.requestMeasure();
  }
  /** Edit the cell at row/column, adding a row first when it's just past the last one. */
  go(row: number, column: number) {
    if (row >= this.table.rows.length) this.change((t) => insertRow(t, t.rows.length));
    const cell = this.cellAt(row, column);
    if (cell) this.activate(cell);
  }
  activate(cell: HTMLTableCellElement) {
    if (this.view.state.readOnly || this.activeCell === cell) return;
    if (this.activeCell) this.finish(this.activeCell);
    this.activeCell = cell;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const input = document.createElement("textarea");
    input.className = "cm-table-cell-input";
    input.value = this.widget.table.rows[row]![column]!;
    input.dataset.row = String(row);
    input.dataset.column = String(column);
    input.setAttribute("aria-label", cell.getAttribute("aria-label")!);
    const picker = new TableCellMenu(input, this.view, cell, (value) =>
      this.editCell(row, column, value),
    );
    this.picker = picker;
    input.addEventListener("input", () => {
      this.editCell(row, column, input.value);
      picker.update();
    });
    input.addEventListener("blur", () => this.finish(cell));
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || picker.keydown(event)) return;
      const width = this.table.alignment.length;
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      const move = (r: number, c: number) => {
        event.preventDefault();
        this.go(r, c);
      };
      if (event.key === "Escape") {
        event.preventDefault();
        this.finish(cell);
        cell.focus();
      } else if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey) {
        // Like Obsidian: Enter goes to the cell below, adding a row after the last one.
        move(row + 1, column);
      } else if (event.key === "Tab" && !event.ctrlKey && !event.altKey) {
        const index = row * width + column + (event.shiftKey ? -1 : 1);
        if (index < 0) return;
        // Tab in the last cell adds a row.
        move(Math.floor(index / width), index % width);
      } else if (
        event.key === "ArrowUp" &&
        !input.value.slice(0, input.selectionStart).includes("\n")
      ) {
        if (row > 0) move(row - 1, column);
      } else if (
        event.key === "ArrowDown" &&
        !input.value.slice(input.selectionEnd).includes("\n")
      ) {
        if (row + 1 < this.table.rows.length) move(row + 1, column);
      } else if (event.key === "ArrowLeft" && atStart && column > 0) {
        move(row, column - 1);
      } else if (event.key === "ArrowRight" && atEnd && column + 1 < width) {
        move(row, column + 1);
      }
    });
    cell.classList.add("cm-table-cell-active");
    cell.append(input);
    input.focus();
  }

  /** The text field of the cell being edited, if any. */
  get input() {
    return this.activeCell?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
  }
  /**
   * Bold, italic or strikethrough on the edited cell's selection (Ctrl+B, Ctrl+I,
   * Ctrl+Shift+S): wrap it, or unwrap it, like `toggleMark` in the note.
   */
  format(mark: string, selection?: { from: number; to: number }) {
    const input = this.input;
    if (!input || !this.activeCell) return false;
    const from = selection?.from ?? input.selectionStart;
    const to = selection?.to ?? input.selectionEnd;
    const next = toggleMarkInText(input.value, from, to, mark);
    input.value = next.text;
    input.setSelectionRange(next.from, next.to);
    this.editCell(
      Number(this.activeCell.dataset.row),
      Number(this.activeCell.dataset.column),
      input.value,
    );
    this.picker?.close();
    return true;
  }

  // ---- Grips, menus and dragging ----

  /** Show the grips of the row and column under the pointer. */
  hover(target: HTMLElement | null) {
    const cell = target?.closest<HTMLTableCellElement>("[data-row]");
    const row = cell ? cell.dataset.row : null;
    const column = cell ? cell.dataset.column : null;
    this.root.querySelectorAll<HTMLElement>(".cm-table-grip").forEach((grip) => {
      const show =
        (grip.dataset.row !== undefined && grip.dataset.row === row) ||
        (grip.dataset.column !== undefined && grip.dataset.column === column);
      grip.classList.toggle("show", show);
    });
  }
  rowItems(row: number): MenuItem[] {
    const last = this.table.rows.length - 1;
    if (row === 0)
      return [{ label: "Insert row below", run: () => this.change((t) => insertRow(t, 1)) }];
    return [
      { label: "Insert row above", run: () => this.change((t) => insertRow(t, row)) },
      { label: "Insert row below", run: () => this.change((t) => insertRow(t, row + 1)) },
      ...(row > 1
        ? [{ label: "Move row up", run: () => this.change((t) => moveRow(t, row, row - 1)) }]
        : []),
      ...(row < last
        ? [{ label: "Move row down", run: () => this.change((t) => moveRow(t, row, row + 1)) }]
        : []),
      { label: "Duplicate row", run: () => this.change((t) => duplicateRow(t, row)) },
      { label: "Delete row", danger: true, run: () => this.change((t) => deleteRow(t, row)) },
    ];
  }
  columnItems(column: number): MenuItem[] {
    const width = this.table.alignment.length;
    const align = (a: TableAlignment, label: string): MenuItem => ({
      label: (this.table.alignment[column] ?? null) === a ? `✓ ${label}` : label,
      run: () => this.change((t) => alignColumn(t, column, a)),
    });
    return [
      { label: "Insert column left", run: () => this.change((t) => insertColumn(t, column)) },
      { label: "Insert column right", run: () => this.change((t) => insertColumn(t, column + 1)) },
      ...(column > 0
        ? [
            {
              label: "Move column left",
              run: () => this.change((t) => moveColumn(t, column, column - 1)),
            },
          ]
        : []),
      ...(column < width - 1
        ? [
            {
              label: "Move column right",
              run: () => this.change((t) => moveColumn(t, column, column + 1)),
            },
          ]
        : []),
      { label: "Duplicate column", run: () => this.change((t) => duplicateColumn(t, column)) },
      "separator",
      align("left", "Align left"),
      align("center", "Align center"),
      align("right", "Align right"),
      "separator",
      { label: "Sort A → Z", run: () => this.change((t) => sortByColumn(t, column, "asc")) },
      { label: "Sort Z → A", run: () => this.change((t) => sortByColumn(t, column, "desc")) },
      ...(width > 1
        ? [
            "separator" as const,
            {
              label: "Delete column",
              danger: true,
              run: () => this.change((t) => deleteColumn(t, column)),
            },
          ]
        : []),
    ];
  }
  tableItems(): MenuItem[] {
    return [
      { label: "Edit as Markdown", run: () => this.showSource() },
      { label: "Tidy up the Markdown", run: () => this.change((t) => ({ ...t })) },
    ];
  }
  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }
  /** A menu of table edits at x, y; focus returns to `back` when it closes. */
  openMenu(label: string, items: MenuItem[], x: number, y: number, back: HTMLElement) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "cm-table-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);
    const close = (refocus: boolean) => {
      this.closeMenu();
      document.removeEventListener("mousedown", away, true);
      if (refocus && back.isConnected) back.focus();
    };
    const away = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) close(false);
    };
    for (const item of items) {
      if (item === "separator") {
        const hr = document.createElement("div");
        hr.className = "cm-table-menu-separator";
        hr.setAttribute("role", "separator");
        menu.append(hr);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
      if (item.danger) button.classList.add("danger");
      button.addEventListener("click", () => {
        close(true);
        item.run();
      });
      menu.append(button);
    }
    menu.addEventListener("keydown", (e) => {
      const buttons = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        close(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        buttons[(at + step + buttons.length) % buttons.length]?.focus();
      }
    });
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 240))}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    document.body.append(menu);
    // Keep it on screen.
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight && box.height < window.innerHeight)
      menu.style.top = `${Math.max(4, window.innerHeight - box.height - 4)}px`;
    this.menu = menu;
    document.addEventListener("mousedown", away, true);
    menu.querySelector<HTMLElement>("button")?.focus();
  }
  cellMenu(cell: HTMLTableCellElement, x: number, y: number) {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    // Right-click while typing in the cell: its text styles first. The menu takes focus
    // (and the cell's text field closes), so the cell opens again with the same selection.
    const input = this.activeCell === cell ? this.input : null;
    const selection = input && { from: input.selectionStart, to: input.selectionEnd };
    const style = (label: string, mark: string): MenuItem => ({
      label,
      run: () => {
        const target = this.cellAt(row, column);
        if (!target || !selection) return;
        this.activate(target);
        this.format(mark, selection);
      },
    });
    this.openMenu(
      "Table",
      [
        ...(selection
          ? [
              style("Bold", "**"),
              style("Italic", "*"),
              style("Strikethrough", "~~"),
              "separator" as const,
            ]
          : []),
        ...this.rowItems(row),
        "separator",
        ...this.columnItems(column),
        "separator",
        ...this.tableItems(),
      ],
      x,
      y,
      cell,
    );
  }
  /**
   * A grip: a click opens its row's or column's menu; dragging it moves the row or column
   * to where it's dropped (pointer events, since the desktop webview swallows HTML drag
   * and drop).
   */
  grip(kind: "row" | "column", index: number) {
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = `cm-table-grip cm-table-grip-${kind}`;
    grip.dataset[kind] = String(index);
    grip.tabIndex = -1;
    const name =
      kind === "row" ? (index === 0 ? "header row" : `row ${index}`) : `column ${index + 1}`;
    grip.setAttribute("aria-label", `Options for ${name}`);
    grip.title = `Click for options · drag to move the ${kind}`;
    const open = () => {
      const box = grip.getBoundingClientRect();
      const items = kind === "row" ? this.rowItems(index) : this.columnItems(index);
      this.openMenu(`Options for ${name}`, items, box.left, box.bottom + 2, grip);
    };
    grip.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || this.widget.readOnly) return;
      down.preventDefault();
      const movable = kind === "column" || index > 0;
      let dragging = false;
      let target: number | null = null;
      const mark = (cells: HTMLElement[], value: string | null) =>
        cells.forEach((c) => (value ? (c.dataset.drop = value) : delete c.dataset.drop));
      const clear = () => mark([...this.root.querySelectorAll<HTMLElement>("[data-drop]")], null);
      const move = (e: PointerEvent) => {
        if (!movable) return;
        if (!dragging && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
        dragging = true;
        this.root.classList.add("cm-table-dragging");
        const over = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-row]");
        clear();
        target = null;
        if (!over || !this.root.contains(over)) return;
        const at = Number(over.dataset[kind]);
        if (kind === "row" && at === 0) return;
        target = at;
        const cells = [
          ...this.root.querySelectorAll<HTMLElement>(`[data-row][data-${kind}="${at}"]`),
        ];
        const [lo, hi] = kind === "row" ? ["before", "after"] : ["left", "right"];
        mark(cells, at < index ? lo! : at > index ? hi! : null);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.root.classList.remove("cm-table-dragging");
        clear();
        if (!dragging) open();
        else if (target !== null && target !== index)
          this.change((t) =>
            kind === "row" ? moveRow(t, index, target!) : moveColumn(t, index, target!),
          );
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    grip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    return grip;
  }

  render() {
    this.activeCell = null;
    this.closeMenu();
    const { table, readOnly } = this.widget;
    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Scrollable Markdown table");
    const element = document.createElement("table");
    element.setAttribute("aria-label", "Markdown table");
    const head = element.createTHead();
    const body = element.createTBody();
    const width = table.alignment.length;
    table.rows.forEach((row, r) => {
      const tr = (r === 0 ? head : body).insertRow();
      for (let c = 0; c < width; c++) {
        const value = row[c] ?? "";
        const cell = document.createElement(r === 0 ? "th" : "td");
        if (r === 0) cell.scope = "col";
        cell.style.textAlign = table.alignment[c] ?? "left";
        const preview = document.createElement("span");
        preview.className = "cm-table-cell-preview";
        inline(preview, value, this.view);
        cell.append(preview);
        cell.dataset.row = String(r);
        cell.dataset.column = String(c);
        if (!readOnly) {
          if (c === 0) cell.append(this.grip("row", r));
          if (r === 0) cell.append(this.grip("column", c));
          cell.dataset.tableCell = "";
          cell.tabIndex = 0;
          cell.setAttribute("aria-label", `${r === 0 ? "Header" : `Row ${r}`}, column ${c + 1}`);
          cell.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).closest("a, button, textarea")) return;
            this.activate(cell);
          });
          cell.addEventListener("contextmenu", (event) => {
            if ((event.target as HTMLElement).closest("a")) return;
            event.preventDefault();
            this.cellMenu(cell, event.clientX, event.clientY);
          });
          cell.addEventListener("keydown", (event) => {
            if (event.target !== cell) return;
            const step: Record<string, [number, number]> = {
              ArrowUp: [-1, 0],
              ArrowDown: [1, 0],
              ArrowLeft: [0, -1],
              ArrowRight: [0, 1],
            };
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              this.activate(cell);
            } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
              event.preventDefault();
              const box = cell.getBoundingClientRect();
              this.cellMenu(cell, box.left, box.bottom);
            } else if (step[event.key]) {
              event.preventDefault();
              const [dr, dc] = step[event.key]!;
              this.cellAt(r + dr, c + dc)?.focus();
            }
          });
        }
        tr.append(cell);
      }
    });
    scroll.append(element);
    if (readOnly) {
      this.root.replaceChildren(scroll);
      return;
    }
    const add = (kind: "row" | "column") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cm-table-add cm-table-add-${kind}`;
      button.textContent = "+";
      button.tabIndex = -1;
      button.setAttribute("aria-label", kind === "row" ? "Add row" : "Add column");
      button.title = kind === "row" ? "Add a row" : "Add a column";
      button.addEventListener("click", () => {
        if (kind === "row") {
          this.change((t) => insertRow(t, t.rows.length));
          this.cellAt(this.table.rows.length - 1, 0)?.click();
        } else {
          this.change((t) => insertColumn(t, t.alignment.length));
          this.cellAt(0, this.table.alignment.length - 1)?.click();
        }
      });
      return button;
    };
    this.root.replaceChildren(scroll, add("column"), add("row"));
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
/**
 * Run a note command in the table cell being typed in at `target`, if that's where the
 * key was pressed: `menu` opens the command menu (Ctrl+/), a mark toggles that style
 * (Ctrl+B and the like). False when `target` isn't a cell being edited.
 */
export function tableCellCommand(
  target: Element | null | undefined,
  command: "menu" | string,
): boolean {
  const input = target?.closest<HTMLTextAreaElement>(".cm-table-cell-input");
  const root = input?.closest<HTMLElement>(".cm-markdown-table");
  const controller = root && controllers.get(root);
  if (!input || !controller || controller.input !== input) return false;
  if (command !== "menu") return controller.format(command);
  controller.picker?.openCommands();
  return true;
}

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
