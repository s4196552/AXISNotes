import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatTable, parseTable, tableCells } from "../../lib/markdownTables";
import { tables } from "./tables";

// Exact Obsidian table supplied by the human (compact syntax and long cells).
const COSTS = `|Category|Hardware/Software|Administration|Facilities cost|
|---|---|---|---|
|1. Server Costs|Hardware: server, rack chassis, PDUs, TOR switches (+ maintenance). Software: OS, virtualization licenses (+ maintenance)|—|Space, Power, Cooling|
|2. Storage Costs|Hardware: storage disks, SAN or FC switches|Storage administration costs|Space, Power, Cooling|
|3. Network Costs|Network hardware: LAN switches, load balancer bandwidth costs|Network administration costs|Space, Power, Cooling|
|4. IT Labor Costs|—|Server administration costs|—|`;
const views: EditorView[] = [];
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
