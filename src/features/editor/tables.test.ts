import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatTable, parseTable, replaceTableCell, tableCells } from "../../lib/markdownTables";
import { tables } from "./tables";

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
    expect(ui.getByRole("table").style.minWidth).toBe("700px");
    expect(ui.getByText("Business Support +").tagName).toBe("STRONG");
    fireEvent.input(input, { target: { value: "$39/mo" } });
    expect(view.state.doc.toString()).toBe(PLANS.replace("$29/mo", "$39/mo"));
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ui.queryByRole("textbox")).toBeNull();
    expect(ui.getByText("$39/mo")).toBeInTheDocument();
    expect(document.activeElement).toBe(cell);
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
    expect(ui.getByRole("table").style.minWidth).toBe("700px");
    expect(ui.getByRole("region", { name: "Scrollable Markdown table" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(view.state.doc.toString()).toBe(PLANS);
    fireEvent.click(ui.getByRole("button", { name: "Edit cells" }));
    expect(ui.getAllByRole("row").every((row) => row.children.length === 6)).toBe(true);
    fireEvent.input(ui.getByLabelText("Row 1, column 4"), { target: { value: "$1/mo" } });
    expect(parseTable(view.state.doc.toString().split("\n"))?.rows[1]?.[3]).toBe("$1/mo");
    fireEvent.click(ui.getByRole("button", { name: "Done editing" }));
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
  it("keeps fenced and indented code literal", () => {
    const view = open("```md\n" + COSTS + "\n```\n\n    | A | B |\n    | --- | --- |\n");
    expect(within(view.dom).queryByRole("table")).toBeNull();
  });
  it("writes cell edits immediately to Markdown, retains focus, and supports undo", () => {
    const view = open(COSTS);
    fireEvent.click(within(view.dom).getByRole("button", { name: "Edit cells" }));
    const cell = within(view.dom).getByLabelText("Row 1, column 3") as HTMLTextAreaElement;
    cell.focus();
    fireEvent.input(cell, { target: { value: "New | estimate" } });
    expect(view.state.doc.toString()).toContain("New \\| estimate");
    expect(document.activeElement).toBe(cell);
    expect(within(view.dom).getByLabelText("Row 1, column 3")).toBe(cell);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(COSTS);
    expect(cell.value).toBe("—");
  });
  it("adds rows and columns and returns to rendered mode", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("button", { name: "Edit cells" }));
    fireEvent.click(ui.getByRole("button", { name: "Add row" }));
    fireEvent.click(ui.getByRole("button", { name: "Add column" }));
    fireEvent.click(ui.getByRole("button", { name: "Remove row 2" }));
    fireEvent.click(ui.getByRole("button", { name: "Remove column 2" }));
    fireEvent.click(ui.getByRole("button", { name: "Done editing" }));
    expect(ui.getAllByRole("columnheader")).toHaveLength(4);
    expect(ui.getAllByRole("row")).toHaveLength(5);
  });
  it("can format explicitly or edit the Markdown source", () => {
    const view = open(COSTS + "\n\nAfter");
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("button", { name: "Format table" }));
    expect(view.state.doc.toString()).toContain("| Category");
    expect(parseTable(view.state.doc.toString().split("\n").slice(0, 6))).toEqual(
      parseTable(COSTS.split("\n")),
    );
    fireEvent.click(ui.getByRole("button", { name: "Edit Markdown" }));
    expect(ui.queryByRole("table")).toBeNull();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(ui.getByRole("table")).toBeInTheDocument();
  });
  it("disables table mutations in a read-only editor", () => {
    const view = open(COSTS, true);
    expect(within(view.dom).getByRole("button", { name: "Edit cells" })).toBeDisabled();
    expect(within(view.dom).getByRole("button", { name: "Format table" })).toBeDisabled();
    expect(view.state.doc.toString()).toBe(COSTS);
    fireEvent.click(within(view.dom).getByText("Storage administration costs"));
    expect(view.dom.querySelector("textarea")).toBeNull();
  });
  it("returns from source mode even when the note contains only a table", () => {
    const view = open(COSTS);
    const ui = within(view.dom);
    fireEvent.click(ui.getByRole("button", { name: "Edit Markdown" }));
    expect(ui.queryByRole("table")).toBeNull();
    view.dispatch({ changes: { from: 0, insert: " " } });
    expect(ui.queryByRole("table")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Show table" }));
    expect(ui.getByRole("table")).toBeInTheDocument();
  });
});
