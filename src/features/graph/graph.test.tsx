import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { GraphData } from "../../ipc";
import { useAppStore } from "../../app/store";
import { buildGraph, folderColor, topFolder } from "./graphModel";
import { GraphView, LocalGraph } from "./GraphView";

const h = vi.hoisted(() => ({
  b: null as unknown as MemoryBackend,
  sigmas: [] as {
    graph: { order: number };
    handlers: Record<string, (e: { node: string }) => void>;
  }[],
}));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
// WebGL isn't available in jsdom: stand in for sigma and the layout.
vi.mock("./graphLibs", () => ({
  loadGraphLibs: async () => ({
    Sigma: class {
      handlers: Record<string, (e: { node: string }) => void> = {};
      constructor(public graph: { order: number }) {
        h.sigmas.push(this);
      }
      on(event: string, fn: (e: { node: string }) => void) {
        this.handlers[event] = fn;
      }
      refresh() {}
      kill() {}
    },
    forceAtlas2: { inferSettings: () => ({}), assign: () => {} },
    FA2Layout: class {
      start() {}
      stop() {}
      kill() {}
    },
  }),
}));

const DATA: GraphData = {
  nodes: [
    { id: "A.md", name: "A", tags: ["work/alpha"], unresolved: false },
    { id: "Dir/B.md", name: "B", tags: [], unresolved: false },
    { id: "Dir/C.md", name: "C", tags: ["home"], unresolved: false },
    { id: "Lonely.md", name: "Lonely", tags: [], unresolved: false },
    { id: "?Ghost", name: "Ghost", tags: [], unresolved: true },
  ],
  edges: [
    { source: "A.md", target: "Dir/B.md" },
    { source: "Dir/B.md", target: "Dir/C.md" },
    { source: "A.md", target: "?Ghost" },
  ],
};

const opts = { query: "", showOrphans: true, showUnresolved: false };

describe("graph model", () => {
  it("includes orphans and hides unresolved targets by default", () => {
    const g = buildGraph(DATA, opts);
    expect(g.nodes().sort()).toEqual(["A.md", "Dir/B.md", "Dir/C.md", "Lonely.md"]);
    expect(g.size).toBe(2);
    expect(buildGraph(DATA, { ...opts, showUnresolved: true }).hasNode("?Ghost")).toBe(true);
    expect(buildGraph(DATA, { ...opts, showOrphans: false }).hasNode("Lonely.md")).toBe(false);
  });

  it("filters by text, tag (with children) and path", () => {
    expect(buildGraph(DATA, { ...opts, query: "tag:work" }).nodes()).toEqual(["A.md"]);
    expect(
      buildGraph(DATA, { ...opts, query: "path:dir/" })
        .nodes()
        .sort(),
    ).toEqual(["Dir/B.md", "Dir/C.md"]);
    expect(buildGraph(DATA, { ...opts, query: "lone" }).nodes()).toEqual(["Lonely.md"]);
  });

  it("builds local neighborhoods by depth", () => {
    expect(
      buildGraph(DATA, { ...opts, center: "A.md", depth: 1 })
        .nodes()
        .sort(),
    ).toEqual(["A.md", "Dir/B.md"]);
    expect(buildGraph(DATA, { ...opts, center: "A.md", depth: 2 }).order).toBe(3);
    expect(buildGraph(DATA, { ...opts, center: "Lonely.md", depth: 2 }).nodes()).toEqual([
      "Lonely.md",
    ]);
  });

  it("sizes by degree, colors by top folder and places nodes deterministically", () => {
    const g = buildGraph(DATA, opts, { accent: "blue", muted: "gray" });
    expect(g.getNodeAttribute("Dir/B.md", "size")).toBeGreaterThan(
      g.getNodeAttribute("Lonely.md", "size"),
    );
    expect(g.getNodeAttribute("A.md", "color")).toBe("blue");
    expect(g.getNodeAttribute("Dir/B.md", "color")).toBe(folderColor("Dir", "blue"));
    expect(topFolder("Dir/B.md")).toBe("Dir");
    const again = buildGraph(DATA, opts);
    expect(again.getNodeAttribute("A.md", "x")).toBe(g.getNodeAttribute("A.md", "x"));
  });
});

describe("graph views", () => {
  beforeEach(async () => {
    h.sigmas.length = 0;
    h.b = createMemoryBackend({
      "A.md": "[[B]] [[Missing]] #work",
      "Dir/B.md": "[[C]]",
      "Dir/C.md": "",
      "Lonely.md": "",
    });
    useAppStore.setState({ activePath: "A.md", mainView: "graph", pendingTarget: null });
    await act(() => useAppStore.getState().refreshTree());
  });

  it("renders the vault graph, filters it and opens notes on click", async () => {
    render(<GraphView />);
    expect(await screen.findByText("4 notes · 2 links")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Unresolved" }));
    expect(screen.getByText("5 notes · 3 links")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter graph" }), {
      target: { value: "tag:work" },
    });
    expect(screen.getByText("1 note · 0 links")).toBeInTheDocument();

    await waitFor(() => expect(h.sigmas.length).toBeGreaterThan(0));
    act(() => h.sigmas.at(-1)!.handlers.clickNode!({ node: "A.md" }));
    expect(useAppStore.getState()).toMatchObject({ activePath: "A.md", mainView: "note" });
  });

  it("creates the note for an unresolved node", async () => {
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Unresolved" }));
    await waitFor(() => expect(h.sigmas.at(-1)?.graph.order).toBe(5));
    act(() => h.sigmas.at(-1)!.handlers.clickNode!({ node: "?Missing" }));
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Missing.md"));
    expect(h.b.files()).toHaveProperty(["Missing.md"]);
  });

  it("shows the open note's neighborhood with adjustable depth", async () => {
    render(<LocalGraph />);
    expect(await screen.findByText("2 notes")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Link depth" }), {
      target: { value: "2" },
    });
    expect(screen.getByText("3 notes")).toBeInTheDocument();
  });

  it("closes back to the note", async () => {
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("button", { name: "Close graph" }));
    expect(useAppStore.getState().mainView).toBe("note");
  });
});
