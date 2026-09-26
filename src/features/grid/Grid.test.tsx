import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { AUTOSAVE_DELAY_MS } from "../files/useFileDocument";
import { Grid } from "./Grid";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const GRID = JSON.stringify({
  version: 1,
  rows: 20,
  cols: 5,
  cells: { A1: "2", A2: "3", A3: "=A1*A2", B1: "Label" },
});

beforeAll(() => {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.b = createMemoryBackend({ "Budget.axgrid": GRID });
  useAppStore.setState({ error: null, activePath: "Budget.axgrid", notes: [] });
});
afterEach(() => vi.useRealTimers());

const cell = (addr: string) => document.querySelector(`[data-addr="${addr}"]`) as HTMLElement;
const grid = () => screen.getByRole("grid");
const saved = () => JSON.parse(h.b.files()["Budget.axgrid"]!) as { cells: Record<string, string> };

async function open() {
  const utils = render(<Grid path="Budget.axgrid" />);
  await waitFor(() => expect(cell("A3")).toHaveTextContent("6"));
  return utils;
}

async function flushSave() {
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10);
  });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
}

function typeInto(addr: string, text: string) {
  fireEvent.mouseDown(cell(addr));
  fireEvent.keyDown(grid(), { key: text[0] });
  const input = screen.getByLabelText(`Edit ${addr}`);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function clipboardEvent(type: string, data: Record<string, string> = {}) {
  const store: Record<string, string> = { ...data };
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", {
    value: {
      getData: (t: string) => store[t] ?? "",
      setData: (t: string, v: string) => (store[t] = v),
    },
  });
  return { e, store };
}

describe("Grid", () => {
  it("shows the title, computed values and row/column headers", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Budget" })).toBeInTheDocument();
    expect(cell("B1")).toHaveTextContent("Label");
    expect(screen.getAllByRole("columnheader").map((e) => e.textContent)).toEqual([
      "",
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("edits a cell by typing, recalculates, and autosaves", async () => {
    await open();
    typeInto("A1", "10");
    expect(cell("A3")).toHaveTextContent("30");
    expect(screen.getByLabelText("Selected range")).toHaveTextContent("A2"); // Enter moved down
    await flushSave();
    expect(saved().cells).toEqual({ A1: "10", B1: "Label", A2: "3", A3: "=A1*A2" });
  });

  it("edits through the formula bar and shows errors", async () => {
    await open();
    fireEvent.mouseDown(cell("C1"));
    const bar = screen.getByLabelText("Formula bar");
    fireEvent.focus(bar);
    fireEvent.change(bar, { target: { value: "=A1/0" } });
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(cell("C1")).toHaveTextContent("#DIV/0!");
    fireEvent.mouseDown(cell("C1"));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("=A1/0");
  });

  it("clears a range with Delete and undoes it", async () => {
    await open();
    fireEvent.mouseDown(cell("A1"));
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    expect(screen.getByLabelText("Selected range")).toHaveTextContent("A1:A2");
    expect(screen.getByText(/Sum 5/)).toBeInTheDocument();
    fireEvent.keyDown(grid(), { key: "Delete" });
    expect(cell("A3")).toHaveTextContent("0");
    fireEvent.keyDown(grid(), { key: "z", ctrlKey: true });
    expect(cell("A3")).toHaveTextContent("6");
    fireEvent.keyDown(grid(), { key: "y", ctrlKey: true });
    expect(cell("A1")).toHaveTextContent("");
  });

  it("inserts a row above and shifts formulas", async () => {
    await open();
    fireEvent.mouseDown(cell("A2"));
    fireEvent.click(screen.getByRole("button", { name: "Insert row above" }));
    expect(cell("A4")).toHaveTextContent("6");
    await flushSave();
    expect(saved().cells.A4).toBe("=A1*A3");
  });

  it("copies values as TSV and pastes with shifted formulas", async () => {
    await open();
    fireEvent.mouseDown(cell("A2"));
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    grid().focus();
    const copy = clipboardEvent("copy");
    act(() => void document.dispatchEvent(copy.e));
    expect(copy.store["text/plain"]).toBe("3\n6");

    fireEvent.mouseDown(cell("C2"));
    const paste = clipboardEvent("paste", copy.store);
    act(() => void document.dispatchEvent(paste.e));
    expect(cell("C3")).toHaveTextContent("0"); // =C1*C2 with C1 empty
    await flushSave();
    expect(saved().cells).toMatchObject({ C2: "3", C3: "=C1*C2" });

    fireEvent.mouseDown(cell("D1"));
    const external = clipboardEvent("paste", { "text/plain": "x\ty\n1\t2" });
    act(() => void document.dispatchEvent(external.e));
    expect(cell("E2")).toHaveTextContent("2");
  });

  it("reloads outside edits when clean and warns when there are local edits", async () => {
    await open();
    act(() =>
      h.b.externalWrite("Budget.axgrid", JSON.stringify({ cells: { A1: "7", A2: "=A1+1" } })),
    );
    await waitFor(() => expect(cell("A2")).toHaveTextContent("8"));

    typeInto("B2", "local");
    act(() => h.b.externalWrite("Budget.axgrid", JSON.stringify({ cells: { A1: "1" } })));
    expect(await screen.findByText("This grid changed on disk.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(saved().cells).toMatchObject({ B2: "local" }));
  });

  it("shows unreadable files read-only and never overwrites them", async () => {
    h.b = createMemoryBackend({ "Budget.axgrid": "{broken" });
    render(<Grid path="Budget.axgrid" />);
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    fireEvent.mouseDown(cell("A1"));
    fireEvent.keyDown(grid(), { key: "x" });
    expect(screen.queryByLabelText("Edit A1")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    });
    expect(h.b.files()["Budget.axgrid"]).toBe("{broken");
  });
});
