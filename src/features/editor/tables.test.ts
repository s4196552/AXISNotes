import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTable, parseTable, replaceTableCell, tableCells } from "../../lib/markdownTables";
import { tables } from "./tables";
import * as ops from "./tableOps";

// Exact Obsidian table supplied by the human (compact syntax and long cells).
const COSTS = `|Category|Hardware/Software|Administration|Facilities cost|
|---|---|---|---|
|1. Server Costs|Hardware: server, rack chassis, PDUs, TOR switches (+ maintenance). Software: OS, virtualization licenses (+ maintenance)|—|Space, Power, Cooling|
|2. Storage Costs|Hardware: storage disks, SAN or FC switches|Storage administration costs|Space, Power, Cooling|
|3. Network Costs|Network hardware: LAN switches, load balancer bandwidth costs|Network administration costs|Space, Power, Cooling|
|4. IT Labor Costs|—|Server administration costs|—|`;
const views: EditorView[] = [];
const PLANS = `| **Plan**           | **Best For**         | **Support Access**                     | **Min. Cost** | **Response Time** |
| ------------------ | -------------------- | -------------------------------------- | ------------- | ----------------- |
| **Basic**              | Early Learning       | 24/7 self-service & billing            | Free          | N/A               |
| **Business Support +** | Production Workloads | 24/7 AI-first & expert chat/phone      | $29/mo        | < 30 mins         |
| **Enterprise Support** | Business-Critical    | Designated TAM & White-glove concierge | $5,000/mo     | < 15 mins         |
| **Unified Operations** | Mission-Critical     | Designated team & managed Incident ops | $50,000/mo    | < 5 mins          |`;
function open(doc: string, readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        history(),
        tables,
        EditorState.readOnly.of(readOnly),
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
describe("Obsidian Markdown tables", () => {
  it("edits one rendered cell directly without changing the layout or surrounding source", () => {
    const view = open(PLANS);
    const ui = within(view.dom.querySelector<HTMLElement>(".cm-markdown-table")!);
    const cell = ui.getByRole("cell", { name: "Row 2, column 4" });
    fireEvent.click(cell);
    const input = ui.getByRole("textbox", { name: "Row 2, column 4" });
    expect(ui.getAllByRole("textbox")).toHaveLength(1);
    expect(ui.getAllByRole("columnheader")).toHaveLength(5);
    expect(ui.getByText("Business Support +").tagName).toBe("STRONG");
    fireEvent.input(input, { target: { value: "$39/mo" } });
    expect(view.state.doc.toString()).toBe(PLANS.replace("$29/mo", "$39/mo"));
    expect(document.activeElement).toBe(input);
    // Like Obsidian, Enter goes on to the cell below.
    fireEvent.keyDown(input, { key: "Enter" });
    const below = ui.getByRole("textbox", { name: "Row 3, column 4" });
    expect(document.activeElement).toBe(below);
    expect(ui.getByText("$39/mo")).toBeInTheDocument();
    fireEvent.keyDown(below, { key: "Escape" });
    expect(ui.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(ui.getByRole("cell", { name: "Row 3, column 4" }));
    expect(cell).toBeInTheDocument();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(PLANS);
    expect(ui.getByText("$29/mo")).toBeInTheDocument();
  });
  it("supports keyboard editing, tabbing, multiline content, and undo while focused", () => {
    const view = open(COSTS);
    const ui = within(view.dom.querySelector<HTMLElement>(".cm-markdown-table")!);
    fireEvent.keyDown(ui.getByRole("cell", { name: "Row 1, column 3" }), { key: "Enter" });
    const input = ui.getByRole("textbox", { name: "Row 1, column 3" });
    fireEvent.input(input, { target: { value: "New | estimate\nReviewed" } });
    expect(view.state.doc.toString()).toBe(
      COSTS.replace("|—|Space", "|New \\| estimate<br>Reviewed|Space"),
    );
    expect(undo(view)).toBe(true);
    expect(input).toHaveValue("—");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(ui.getAllByRole("textbox")).toHaveLength(1);
    const next = ui.getByRole("textbox", { name: "Row 1, column 4" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(ui.getByRole("textbox", { name: "Row 1, column 3" }), { key: "Escape" });
    expect(ui.queryByRole("textbox")).toBeNull();
  });
  it("retains typed spaces between individual keystrokes without accumulating source padding", () => {
    const view = open(COSTS);
    const ui = within(view.dom.querySelector<HTMLElement>(".cm-markdown-table")!);
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 3" }));
    const input = ui.getByRole("textbox") as HTMLTextAreaElement;
    let typed = "";
    for (const character of "Reviewed administration") {
      typed += character;
      fireEvent.input(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
    expect(view.state.doc.toString()).toBe(
      COSTS.replace("|—|Space", "|Reviewed administration|Space"),
    );
  });
  it("preserves cell markup, unedited whitespace, optional borders and missing cells", () => {
    const source =
      "  A | B | C  \n :--- | ---: | :---: \n **bold** | `x|y` | [[Note|Alias]] \n short";
    expect(replaceTableCell(source, 1, 1, "`a|b` and [[Other|Label]]")).toBe(
      source.replace("`x|y`", "`a|b` and [[Other|Label]]"),
    );
    const edited = replaceTableCell(source, 2, 2, "added | value");
    expect(parseTable(edited.split("\n"))?.rows[2]).toEqual(["short", "", "added \\| value"]);
    expect(edited.split("\n").slice(0, 3)).toEqual(source.split("\n").slice(0, 3));
    const view = open(PLANS);
    const ui = within(view.dom.querySelector<HTMLElement>(".cm-markdown-table")!);
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 1" }));
    fireEvent.input(ui.getByRole("textbox"), { target: { value: "**Basic Plus**" } });
    fireEvent.blur(ui.getByRole("textbox"));
    expect(ui.getByText("Basic Plus").tagName).toBe("STRONG");
    expect(view.state.doc.toString()).toBe(PLANS.replace("**Basic**", "**Basic Plus**"));
  });
  it("keeps borderless header cells editable when cleared and fills padded cells", () => {
    const source = "A | B | C\n--- | --- | ---\none | two\nlast | row | end";
    const view = open(source);
    const ui = within(view.dom.querySelector<HTMLElement>(".cm-markdown-table")!);
    fireEvent.click(ui.getByRole("columnheader", { name: "Header, column 1" }));
    const header = ui.getByRole("textbox");
    fireEvent.input(header, { target: { value: "" } });
    expect(ui.getByRole("textbox")).toBe(header);
    expect(ui.getAllByRole("columnheader")).toHaveLength(3);
    fireEvent.input(header, { target: { value: "New header" } });
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 3" }));
    fireEvent.input(ui.getByRole("textbox"), { target: { value: "added" } });
    expect(parseTable(view.state.doc.toString().split("\n"))?.rows[1]).toEqual([
      "one",
      "two",
      "added",
    ]);
    expect(replaceTableCell(source, 0, 2, "").split("\n")[0]).toBe("A | B | |");
    const irregular = "| A | B |\n| --- | ---: |\n| one | two | extra |";
    expect(
      parseTable(replaceTableCell(irregular, 0, 2, "New column").split("\n"))?.rows[0],
    ).toEqual(["A", "B", "New column"]);
  });
  it("renders the supplied five-column plans with literal prices, times and bold text", () => {
    const view = open(PLANS);
    const ui = within(view.dom);
    expect(ui.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Plan",
      "Best For",
      "Support Access",
      "Min. Cost",
      "Response Time",
    ]);
    expect(ui.getAllByRole("row")).toHaveLength(5);
    expect(ui.getByText("< 30 mins")).toBeInTheDocument();
    expect(ui.getByText("$50,000/mo")).toBeInTheDocument();
    expect(ui.getByText("Business Support +").tagName).toBe("STRONG");
    expect(ui.getByRole("region", { name: "Scrollable Markdown table" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(view.state.doc.toString()).toBe(PLANS);
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 4" }));
    fireEvent.input(ui.getByRole("textbox", { name: "Row 1, column 4" }), {
      target: { value: "$1/mo" },
    });
    expect(parseTable(view.state.doc.toString().split("\n"))?.rows[1]?.[3]).toBe("$1/mo");
    fireEvent.keyDown(view.dom.querySelector("textarea")!, { key: "Escape" });
    expect(ui.getAllByRole("row").every((row) => row.children.length === 5)).toBe(true);
    expect(ui.getByText("$1/mo")).toBeInTheDocument();
  });
  it("renders the supplied costs table without modifying its source", () => {
    const view = open(COSTS);
    expect(within(view.dom).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(view.dom).getAllByRole("row")).toHaveLength(5);
    expect(within(view.dom).getByText("Network administration costs")).toBeInTheDocument();
    expect(view.state.doc.toString()).toBe(COSTS);
  });
  it("preserves escaped pipes, code spans, aliases, alignments and irregular rows", () => {
    expect(tableCells("| A\\|B | `x|y` | [[Note|Alias]] |")).toEqual([
      "A\\|B",
      "`x|y`",
      "[[Note|Alias]]",
    ]);
    const parsed = parseTable(["A | B", ":--- | ---:", "one | two | extra"]);
    expect(parsed?.alignment).toEqual(["left", "right", null]);
    expect(parseTable(formatTable(parsed!).split("\n"))).toEqual(parsed);
    expect(tableCells("| A | ")).toEqual(["A"]);
    expect(parseTable(["one | two", "--- | no"])).toBeNull();
  });
  it("shows inline code and <br>-joined code blocks in cells (T-286)", () => {
    const doc =
      "| Code | Block |\n| --- | --- |\n| `a | b` | ```ts<br>const x = 1;<br>if (a || b) go();<br>``` after |\n|  | ~~~<br>plain<br>~~~ |";
    const view = open(doc);
    const ui = within(view.dom);
    const inline = ui.getByText("a | b");
    expect(inline.tagName).toBe("CODE");
    expect(inline).toHaveClass("cm-lp-code");
    const block = view.dom.querySelector<HTMLElement>(".cm-table-codeblock")!;
    expect(block.tagName).toBe("PRE");
    expect(block.dataset.language).toBe("ts");
    expect(block.textContent).toBe("const x = 1;\nif (a || b) go();");
    expect(block.parentElement!.textContent).toContain("after");
    const second = view.dom.querySelectorAll(".cm-table-codeblock")[1]!;
    expect(second.textContent).toBe("plain");
    // The empty cell still has its preview line, so the row keeps a text line's height.
    expect(
      ui.getByRole("cell", { name: "Row 2, column 1" }).querySelector(".cm-table-cell-preview"),
    ).not.toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("keeps fenced and indented code literal", () => {
    const view = open("```md\n" + COSTS + "\n```\n\n    | A | B |\n    | --- | --- |\n");
    expect(within(view.dom).queryByRole("table")).toBeNull();
  });
  it("writes cell edits immediately to Markdown, retains focus, and supports undo", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 3" }));
    const cell = ui.getByRole("textbox", { name: "Row 1, column 3" }) as HTMLTextAreaElement;
    fireEvent.input(cell, { target: { value: "New | estimate" } });
    expect(view.state.doc.toString()).toContain("New \\| estimate");
    expect(document.activeElement).toBe(cell);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(COSTS);
    expect(cell.value).toBe("—");
  });
  it("moves between cells with Tab, Enter and the arrow keys, adding a row at the end", () => {
    const view = open("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("cell", { name: "Row 1, column 2" }));
    // Tab in the last cell adds a row and goes to its first cell.
    fireEvent.keyDown(view.dom.querySelector("textarea")!, { key: "Tab" });
    expect(ui.getAllByRole("row")).toHaveLength(3);
    const added = ui.getByRole("textbox", { name: "Row 2, column 1" });
    expect(document.activeElement).toBe(added);
    expect(parseTable(view.state.doc.toString().split("\n"))?.rows).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["", ""],
    ]);
    // Enter on the last row adds another.
    fireEvent.keyDown(added, { key: "Enter" });
    expect(ui.getAllByRole("row")).toHaveLength(4);
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 3, column 1" }));
    // Arrows leave a cell at its edges.
    const at = view.dom.querySelector("textarea")!;
    fireEvent.keyDown(at, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 2, column 1" }));
    fireEvent.keyDown(view.dom.querySelector("textarea")!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 2, column 2" }));
    fireEvent.keyDown(view.dom.querySelector("textarea")!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 2, column 1" }));
    // Shift+Enter is a line break inside the cell, not a move.
    fireEvent.keyDown(view.dom.querySelector("textarea")!, { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 2, column 1" }));
  });
  it("adds a row or column with the + bars", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("button", { name: "Add row" }));
    expect(ui.getAllByRole("row")).toHaveLength(6);
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Row 5, column 1" }));
    fireEvent.click(ui.getByRole("button", { name: "Add column" }));
    expect(ui.getAllByRole("columnheader")).toHaveLength(5);
    expect(document.activeElement).toBe(ui.getByRole("textbox", { name: "Header, column 5" }));
    expect(parseTable(view.state.doc.toString().split("\n"))?.rows[5]).toEqual([
      "",
      "",
      "",
      "",
      "",
    ]);
  });
  it("edits rows and columns from the grips' menus, like Obsidian", () => {
    const view = open("| A | B |\n| --- | --- |\n| 1 | x |\n| 2 | y |");
    const ui = within(view.dom);
    const menu = (grip: string) => {
      const button = ui.getByRole("button", { name: grip });
      fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerUp(window);
      return within(screen.getByRole("menu"));
    };
    const rows = () => parseTable(view.state.doc.toString().split("\n"))!.rows;
    menu("Options for row 1").getByRole("menuitem", { name: "Move row down" }).click();
    expect(rows().slice(1)).toEqual([
      ["2", "y"],
      ["1", "x"],
    ]);
    menu("Options for row 2").getByRole("menuitem", { name: "Duplicate row" }).click();
    expect(rows()).toHaveLength(4);
    menu("Options for row 3").getByRole("menuitem", { name: "Delete row" }).click();
    expect(rows()).toHaveLength(3);
    menu("Options for column 2").getByRole("menuitem", { name: "Align right" }).click();
    expect(parseTable(view.state.doc.toString().split("\n"))!.alignment).toEqual([null, "right"]);
    menu("Options for column 2").getByRole("menuitem", { name: "Sort A → Z" }).click();
    expect(rows().slice(1)).toEqual([
      ["1", "x"],
      ["2", "y"],
    ]);
    menu("Options for column 1").getByRole("menuitem", { name: "Move column right" }).click();
    expect(rows()[0]).toEqual(["B", "A"]);
    menu("Options for column 1").getByRole("menuitem", { name: "Insert column left" }).click();
    expect(rows()[0]).toEqual(["", "B", "A"]);
    menu("Options for column 1").getByRole("menuitem", { name: "Delete column" }).click();
    expect(rows()[0]).toEqual(["B", "A"]);
    // The header row can only have a row added below it.
    expect(
      menu("Options for header row")
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Insert row below"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("drags a row or column by its grip to a new place", () => {
    const view = open("| A | B |\n| --- | --- |\n| 1 | x |\n| 2 | y |\n| 3 | z |");
    const ui = within(view.dom);
    const drag = (grip: string, onto: HTMLElement) => {
      const button = ui.getByRole("button", { name: grip });
      document.elementFromPoint = vi.fn(() => onto);
      fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
      fireEvent.pointerUp(window);
    };
    const rows = () => parseTable(view.state.doc.toString().split("\n"))!.rows;
    drag("Options for row 1", ui.getByRole("cell", { name: "Row 3, column 1" }));
    expect(rows().map((r) => r[0])).toEqual(["A", "2", "3", "1"]);
    drag("Options for column 1", ui.getByRole("cell", { name: "Row 1, column 2" }));
    expect(rows()[0]).toEqual(["B", "A"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("offers a cell's row, column and table edits on right-click or the menu key", () => {
    const view = open(COSTS + "\n\nAfter");
    const ui = within(view.dom);
    fireEvent.contextMenu(ui.getByRole("cell", { name: "Row 1, column 1" }));
    const items = within(screen.getByRole("menu", { name: "Table" }))
      .getAllByRole("menuitem")
      .map((m) => m.textContent);
    expect(items).toEqual(
      expect.arrayContaining([
        "Insert row above",
        "Delete row",
        "Insert column right",
        "Align center",
        "Edit as Markdown",
        "Tidy up the Markdown",
      ]),
    );
    within(screen.getByRole("menu"))
      .getByRole("menuitem", { name: "Tidy up the Markdown" })
      .click();
    expect(view.state.doc.toString()).toContain("| Category");
    expect(parseTable(view.state.doc.toString().split("\n").slice(0, 6))).toEqual(
      parseTable(COSTS.split("\n")),
    );
    fireEvent.keyDown(ui.getByRole("cell", { name: "Row 2, column 2" }), { key: "ContextMenu" });
    within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit as Markdown" }).click();
    expect(ui.queryByRole("table")).toBeNull();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(ui.getByRole("table")).toBeInTheDocument();
  });
  it("moves between cells with the arrow keys before editing", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    const first = ui.getByRole("cell", { name: "Row 1, column 1" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(ui.getByRole("cell", { name: "Row 1, column 2" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(ui.getByRole("cell", { name: "Row 2, column 2" }));
  });
  it("has no grips, + bars or editing in a read-only editor", () => {
    const view = open(COSTS, true);
    expect(within(view.dom).queryByRole("button", { name: "Add row" })).toBeNull();
    expect(view.dom.querySelector(".cm-table-grip")).toBeNull();
    expect(view.state.doc.toString()).toBe(COSTS);
    fireEvent.click(within(view.dom).getByText("Storage administration costs"));
    expect(view.dom.querySelector("textarea")).toBeNull();
  });
  it("returns from source mode even when the note contains only a table", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    fireEvent.contextMenu(ui.getByRole("cell", { name: "Row 1, column 1" }));
    within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit as Markdown" }).click();
    expect(ui.queryByRole("table")).toBeNull();
    view.dispatch({ changes: { from: 0, insert: " " } });
    expect(ui.queryByRole("table")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Show table" }));
    expect(ui.getByRole("table")).toBeInTheDocument();
  });
});

describe("table row and column edits (T-259)", () => {
  const t = {
    rows: [
      ["H1", "H2"],
      ["a", "10"],
      ["b", "9"],
      ["", "1"],
    ],
    alignment: [null, null],
  } as const;
  const table = () => structuredClone(t) as unknown as Parameters<typeof ops.insertRow>[0];
  it("keeps the header first and never changes the original", () => {
    const base = table();
    expect(ops.insertRow(base, 0).rows[1]).toEqual(["", ""]);
    expect(ops.moveRow(base, 1, 0).rows[0]).toEqual(["H1", "H2"]);
    expect(ops.deleteRow(base, 0)).toBe(base);
    expect(base).toEqual(table());
  });
  it("sorts numbers in order and puts empty cells last", () => {
    expect(ops.sortByColumn(table(), 1, "asc").rows.map((r) => r[1])).toEqual([
      "H2",
      "1",
      "9",
      "10",
    ]);
    expect(ops.sortByColumn(table(), 0, "desc").rows.map((r) => r[0])).toEqual([
      "H1",
      "b",
      "a",
      "",
    ]);
  });
  it("inserts, duplicates, moves and deletes columns with their alignment", () => {
    let x = ops.alignColumn(table(), 1, "right");
    x = ops.duplicateColumn(x, 1);
    expect(x.alignment).toEqual([null, "right", "right"]);
    x = ops.moveColumn(x, 0, 2);
    expect(x.rows[0]).toEqual(["H2", "H2", "H1"]);
    x = ops.insertColumn(x, 1);
    expect(x.rows[1]).toEqual(["10", "", "10", "a"]);
    expect(ops.deleteColumn(ops.deleteColumn(x, 0), 0).alignment).toEqual(["right", null]);
    // The last column can't be deleted.
    const one = { rows: [["A"], ["1"]], alignment: [null] };
    expect(ops.deleteColumn(one, 0)).toBe(one);
  });
});
