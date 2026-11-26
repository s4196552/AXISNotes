import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { commandForEvent } from "../commands/registry";
import { toggleMarkInText } from "./inlineMarks";
import { DEFAULT_QUICK_CONFIG, type QuickCommandConfig, quickCommandConfig } from "./quickCommands";
import { applyCellAction, cellCommandItems, FILTERED_SECTION } from "./tableCellMenu";
import { tableCellCommand, tables } from "./tables";

const views: EditorView[] = [];
function open(doc: string, cfg: Partial<QuickCommandConfig> = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        tables,
        quickCommandConfig.of({ ...DEFAULT_QUICK_CONFIG, ...cfg }),
      ],
    }),
  });
  views.push(view);
  return view;
}
afterEach(() => {
  views.splice(0).forEach((view) => {
    view.destroy();
    view.dom.parentElement?.remove();
  });
});

const TABLE = "| A | B |\n| --- | --- |\n| Hello | 2 |";

/** Start typing in body cell (1, column) and return its text field. */
function edit(view: EditorView, column = 1) {
  const ui = within(view.dom);
  fireEvent.click(ui.getByRole("cell", { name: `Row 1, column ${column}` }));
  return ui.getByRole("textbox", { name: `Row 1, column ${column}` }) as HTMLTextAreaElement;
}

const type = (input: HTMLTextAreaElement, value: string) =>
  fireEvent.input(input, { target: { value } });

const row = (view: EditorView) => view.state.doc.toString().split("\n").at(-1);

describe("commands and styles while typing in a table cell (T-263)", () => {
  it("offers only commands that fit in a cell, in the note menu's sections", () => {
    const items = cellCommandItems(DEFAULT_QUICK_CONFIG);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining(["bold", "italic", "strikethrough", "link", "date"]),
    );
    // Blocks need lines of their own.
    for (const id of ["h1", "table", "code", "bullet", "divider", "ai"])
      expect(ids).not.toContain(id);
    expect(items.find((i) => i.id === "bold")?.section).toBe("Text style");
    const disabled = cellCommandItems({ ...DEFAULT_QUICK_CONFIG, disabled: ["bold"] });
    expect(disabled.map((i) => i.id)).not.toContain("bold");
    const typed = cellCommandItems(DEFAULT_QUICK_CONFIG, "ital");
    expect(typed[0]).toMatchObject({ id: "italic", section: FILTERED_SECTION });
    // Punctuation in a label doesn't stop a typed phrase from finding it.
    expect(cellCommandItems(DEFAULT_QUICK_CONFIG, "priority high")[0]?.id).toBe("priority-high");
    expect(cellCommandItems(DEFAULT_QUICK_CONFIG, "Priority: high")[0]?.id).toBe("priority-high");
    expect(cellCommandItems(DEFAULT_QUICK_CONFIG, "high")[0]?.id).toBe("priority-high");
    expect(cellCommandItems(DEFAULT_QUICK_CONFIG, "nothing like this")).toEqual([]);
  });

  it("toggles marks on plain text the way the note does", () => {
    expect(toggleMarkInText("Hello world", 0, 5, "**")).toEqual({
      text: "**Hello** world",
      from: 2,
      to: 7,
    });
    expect(toggleMarkInText("**Hello** world", 2, 7, "**").text).toBe("Hello world");
    expect(toggleMarkInText("ab", 1, 1, "~~")).toEqual({ text: "a~~~~b", from: 3, to: 3 });
  });

  it("keeps what it inserts on one line", () => {
    expect(applyCellAction("x /da", 2, 5, { text: "a\nb" })).toEqual({
      text: "x a<br>b",
      from: 8,
      to: 8,
    });
    expect(applyCellAction("x ", 2, 2, { text: "[[]]", cursor: 2 }).from).toBe(4);
  });

  it("wraps the cell's selection with Ctrl+B, Ctrl+I and Ctrl+Shift+S, not the note's", () => {
    const view = open(`Before\n\n${TABLE}`);
    const input = edit(view);
    input.setSelectionRange(0, 5);
    const press = (key: string, shift = false) => {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: shift });
      let ran = false;
      input.addEventListener(
        "keydown",
        (e) => {
          const cmd = commandForEvent(e);
          expect(cmd).toBeDefined();
          cmd!.run(e.target as Element);
          ran = true;
        },
        { once: true },
      );
      input.dispatchEvent(event);
      expect(ran).toBe(true);
    };
    press("b");
    expect(view.state.doc.toString()).toBe(`Before\n\n| A | B |\n| --- | --- |\n| **Hello** | 2 |`);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
    press("i");
    expect(row(view)).toBe("| ***Hello*** | 2 |");
    press("b");
    press("i");
    press("s", true);
    expect(row(view)).toBe("| ~~Hello~~ | 2 |");
    expect(document.activeElement).toBe(input);
  });

  it("shows bold, italic and strikethrough in cells with the note's styles and colors", () => {
    const view = open("| A |\n| --- |\n| **b** *i* ~~s~~ ![Rocket](<lucide:Rocket>) |");
    const cell = within(view.dom).getByRole("cell", { name: "Row 1, column 1" });
    expect(cell.querySelector("strong")).toHaveClass("cm-lp-strong");
    expect(cell.querySelector("em")).toHaveClass("cm-lp-em");
    expect(cell.querySelector("s")).toHaveClass("cm-lp-strike");
    expect(within(cell).getByRole("img", { name: "Rocket" })).toHaveClass("cm-inline-note-icon");
  });

  it("opens the command menu with Ctrl+/ in a cell, filtered by what's typed", async () => {
    const view = open(TABLE);
    const input = edit(view);
    input.setSelectionRange(0, 5);
    expect(tableCellCommand(input, "menu")).toBe(true);
    const menu = view.dom.querySelector<HTMLElement>(".cm-table-cell-menu")!;
    expect(within(menu).getByRole("option", { name: /Bold/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /Heading 1/ })).toBeNull();
    fireEvent.click(within(menu).getByRole("option", { name: /Italic/ }));
    expect(row(view)).toBe("| *Hello* | 2 |");
    expect(view.dom.querySelector(".cm-table-cell-menu")).toBeNull();

    // Typed after Ctrl+/: filters, Enter inserts in place of what was typed.
    input.setSelectionRange(input.value.length, input.value.length);
    tableCellCommand(input, "menu");
    type(input, "*Hello*link");
    const options = within(
      view.dom.querySelector<HTMLElement>(".cm-table-cell-menu")!,
    ).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Link to note");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(row(view)).toBe("| *Hello*[[]] | 2 |");
    expect(input.selectionStart).toBe("*Hello*[[".length);
    // Escape closes the menu without leaving the cell.
    tableCellCommand(input, "menu");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(view.dom.querySelector(".cm-table-cell-menu")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("escapes | and line breaks from a custom command", () => {
    const view = open(TABLE, { custom: [{ label: "Signature", insert: "a | b\nc{{cursor}}" }] });
    const input = edit(view, 2);
    input.setSelectionRange(1, 1);
    tableCellCommand(input, "menu");
    type(input, "2sig");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(row(view)).toBe("| Hello | 2a \\| b<br>c |");
    expect(view.state.doc.lines).toBe(3);
  });

  it("opens emoji and icons with : in a cell", async () => {
    const view = open(TABLE);
    const input = edit(view, 2);
    type(input, "2 :rocke");
    const option = await waitFor(
      () =>
        within(view.dom.querySelector<HTMLElement>(".cm-table-cell-menu")!).getAllByRole("option", {
          name: /🚀/,
        })[0]!,
    );
    expect(option).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(row(view)).toBe("| Hello | 2 🚀 |");
    // A time isn't a trigger.
    type(input, "10:30");
    expect(view.dom.querySelector(".cm-table-cell-menu")).toBeNull();
  });

  it("inserts an icon that shows as an icon in the cell", async () => {
    const view = open(TABLE);
    const input = edit(view, 2);
    type(input, ":rocket");
    // Built-in icons come after the emoji, with a preview of the icon.
    const icon = await waitFor(() => {
      const found = [...view.dom.querySelectorAll(".cm-table-cell-menu li[role=option]")].find(
        (li) => li.querySelector(".cm-note-icon-preview"),
      );
      expect(found).toBeDefined();
      return found!;
    });
    const label = icon.querySelector(".cm-completionLabel")!.textContent!;
    fireEvent.click(icon);
    expect(row(view)).toMatch(/^\| Hello \| !\[[^\]]+\]\(<lucide:\w+>\) \|$/);
    fireEvent.blur(input);
    const cell = within(view.dom).getByRole("cell", { name: "Row 1, column 2" });
    expect(within(cell).getByRole("img", { name: label })).toHaveClass("cm-inline-note-icon");
  });

  it("styles the selection from the right-click menu while typing in a cell", () => {
    const view = open(TABLE);
    const input = edit(view);
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input);
    fireEvent.click(within(document.body).getByRole("menuitem", { name: "Strikethrough" }));
    expect(row(view)).toBe("| ~~Hello~~ | 2 |");
  });
});
