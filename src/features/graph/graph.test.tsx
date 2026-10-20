import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { GraphData } from "../../ipc";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { buildGraph, folderColor, groupColors, topFolder } from "./graphModel";
import { GraphView, LocalGraph } from "./GraphView";

const h = vi.hoisted(() => ({
  b: null as unknown as MemoryBackend,
  sigmas: [] as {
    graph: { order: number };
    handlers: Record<string, (e: { node: string }) => void>;
    resizes: number;
    resets: number;
    settings: Record<string, unknown>;
    killed: boolean;
  }[],
  observers: [] as { cb: () => void; disconnected: boolean }[],
}));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
// WebGL isn't available in jsdom: stand in for sigma (the physics is the real d3-force).
vi.mock("./graphLibs", () => ({
  loadGraphLibs: async () => ({
    Sigma: class {
      handlers: Record<string, (e: { node: string }) => void> = {};
      resizes = 0;
      resets = 0;
      killed = false;
      constructor(
        public graph: { order: number },
        _el: HTMLElement,
        public settings: Record<string, unknown>,
      ) {
        h.sigmas.push(this);
      }
      on(event: string, fn: (e: { node: string }) => void) {
        this.handlers[event] = fn;
      }
      refresh() {}
      resize() {
        this.resizes++;
      }
      setSetting(key: string, value: unknown) {
        this.settings[key] = value;
      }
      getBBox() {
        return { x: [0, 1], y: [0, 1] };
      }
      setCustomBBox() {}
      getCamera() {
        return {
          setState() {},
          animatedReset: async () => {
            this.resets++;
          },
        };
      }
      viewportToGraph(p: { x: number; y: number }) {
        return p;
      }
      kill() {
        this.killed = true;
      }
    },
    d3: await vi.importActual<typeof import("d3-force")>("d3-force"),
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
    // Hex, which sigma can draw (it renders hsl() black).
    expect(folderColor("Dir", "blue")).toMatch(/^#[0-9a-f]{6}$/);
    expect(folderColor("", "blue")).toBe("blue");
    expect(topFolder("Dir/B.md")).toBe("Dir");
    const again = buildGraph(DATA, opts);
    expect(again.getNodeAttribute("A.md", "x")).toBe(g.getNodeAttribute("A.md", "x"));
  });

  it("colours notes by the first colour group they match", () => {
    const g = buildGraph(DATA, opts);
    const colors = groupColors(g, [
      { query: "", color: "#000000" },
      { query: "path:dir/", color: "#111111" },
      { query: "tag:work", color: "#222222" },
      { query: "B", color: "#333333" },
    ]);
    expect(Object.fromEntries(colors)).toEqual({
      "Dir/B.md": "#111111",
      "Dir/C.md": "#111111",
      "A.md": "#222222",
    });
    expect(groupColors(g, []).size).toBe(0);
  });
});

describe("graph views", () => {
  beforeEach(async () => {
    h.sigmas.length = 0;
    localStorage.clear();
    h.b = createMemoryBackend({
      "A.md": "[[B]] [[Missing]] #work",
      "Dir/B.md": "[[C]]",
      "Dir/C.md": "",
      "Lonely.md": "",
    });
    useAppStore.setState({ activePath: "A.md", mainView: "graph", pendingTarget: null });
    useConfig.setState({ config: DEFAULT_CONFIG });
    await act(() => useAppStore.getState().refreshTree());
  });

  it("renders the vault graph, filters it and opens notes on click", async () => {
    render(<GraphView />);
    expect(await screen.findByText("4 notes · 2 links")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Graph settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Unresolved links" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Graph settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Unresolved links" }));
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

  it("redraws when its container changes size (side panels hidden or shown)", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        o: { cb: () => void; disconnected: boolean };
        constructor(cb: () => void) {
          this.o = { cb, disconnected: false };
          h.observers.push(this.o);
        }
        observe() {}
        disconnect() {
          this.o.disconnected = true;
        }
      },
    );
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => (fn(), 1));
    try {
      const { unmount } = render(<GraphView />);
      await waitFor(() => expect(h.sigmas.length).toBeGreaterThan(0));
      const sigma = h.sigmas.at(-1)!;
      const observer = h.observers.at(-1)!;
      observer.cb();
      expect(sigma.resizes).toBe(1);
      unmount();
      expect(observer.disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("applies display settings and groups without re-creating the graph", async () => {
    render(<GraphView />);
    await waitFor(() => expect(h.sigmas.length).toBe(1));
    const sigma = h.sigmas[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Graph settings" }));
    fireEvent.change(screen.getByRole("slider", { name: "Text fade threshold" }), {
      target: { value: "12" },
    });
    expect(sigma.settings.labelRenderedSizeThreshold).toBe(12);
    fireEvent.click(screen.getByRole("switch", { name: "Arrows" }));
    fireEvent.click(screen.getByRole("button", { name: /New group/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Group 1 query" }), {
      target: { value: "tag:work" },
    });
    // Forces reheat the same simulation; Animate scatters it again. Neither remounts.
    fireEvent.change(screen.getByRole("slider", { name: "Repel force" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Animate" }));
    expect(h.sigmas.length).toBe(1);

    const reducer = sigma.settings.nodeReducer as (n: string, d: object) => { color: string };
    const edgeReducer = sigma.settings.edgeReducer as (e: string, d: object) => { type: string };
    expect(reducer("A.md", { color: "#999999", size: 5 }).color).toBe("#e5484d");
    expect(reducer("Dir/B.md", { color: "#999999", size: 5 }).color).toBe("#999999");
    expect(edgeReducer("e", { size: 1 }).type).toBe("arrow");
    // Remembered on this device.
    expect(JSON.parse(localStorage.getItem("axisnotes.graph")!)).toMatchObject({
      groups: [{ query: "tag:work", color: "#e5484d" }],
      display: { arrows: true, textFade: 12 },
      forces: { repel: 3 },
    });
  });

  it("draws a tree from the open note and switches its root", async () => {
    const first = render(<GraphView />);
    await waitFor(() => expect(h.sigmas.length).toBe(1));
    fireEvent.click(screen.getByRole("radio", { name: /Tree/ }));
    // Leaving the graph layout stops its renderer.
    expect(h.sigmas[0]!.killed).toBe(true);
    const tree = await screen.findByRole("tree", { name: "Note tree" });
    const items = () =>
      Array.from(tree.querySelectorAll("[role=treeitem]")).map(
        (el) => `${el.getAttribute("aria-level")}:${el.getAttribute("aria-label")}`,
      );
    expect(items()).toEqual(["1:A", "2:B", "3:C"]);
    expect(screen.getByRole("combobox", { name: "Tree root" })).toHaveValue("A.md");
    expect(screen.getByText("3 notes")).toBeInTheDocument();

    // Right-click makes a node the root; the open note is still highlighted when shown.
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "B" }));
    expect(items()).toEqual(["1:B", "2:C"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Tree follows" }), {
      target: { value: "backlinks" },
    });
    expect(items()).toEqual(["1:B", "2:A"]);
    expect(screen.getByRole("treeitem", { name: "A" })).toHaveAttribute("aria-current", "page");

    // Collapse and expand with the keyboard; Enter opens the note.
    const b = screen.getByRole("treeitem", { name: "B" });
    fireEvent.keyDown(b, { key: "ArrowLeft" });
    expect(items()).toEqual(["1:B"]);
    expect(b).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(b, { key: "ArrowRight" });
    expect(items()).toEqual(["1:B", "2:A"]);
    fireEvent.keyDown(b, { key: "Enter" });
    expect(useAppStore.getState()).toMatchObject({ activePath: "Dir/B.md", mainView: "note" });
    first.unmount();

    // The root field: a typed name is picked on Enter, a suggestion (full path) at once.
    const { unmount } = render(<GraphView />);
    const field = await screen.findByRole("combobox", { name: "Tree root" });
    fireEvent.change(field, { target: { value: "c" } });
    expect(field).toHaveValue("c");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("Dir/C.md");
    fireEvent.change(field, { target: { value: "Lonely.md" } });
    expect(field).toHaveValue("Lonely.md");
    expect(screen.getAllByRole("treeitem").map((el) => el.getAttribute("aria-label"))).toEqual([
      "Lonely",
    ]);
    unmount();

    // The layout is remembered.
    render(<GraphView />);
    expect(await screen.findByRole("tree", { name: "Note tree" })).toBeInTheDocument();
  });

  it("draws the vault's folders as a tree", async () => {
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("radio", { name: /Tree/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Tree follows" }), {
      target: { value: "folders" },
    });
    const tree = await screen.findByRole("tree", { name: "Note tree" });
    expect(
      Array.from(tree.querySelectorAll("[role=treeitem]")).map((el) =>
        el.getAttribute("aria-label"),
      ),
    ).toEqual(["Vault", "Dir", "B", "C", "A", "Lonely"]);
    expect(screen.queryByRole("combobox", { name: "Tree root" })).toBeNull();
    // Clicking a note opens it.
    fireEvent.click(screen.getByRole("treeitem", { name: "Lonely" }));
    expect(useAppStore.getState().activePath).toBe("Lonely.md");
  });

  it("shows icons on tree nodes by default, and an Icons checkbox hides them", async () => {
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        folderIcons: { "Dir/B.md": { icon: "🧪" }, Dir: { icon: "📁" } },
      },
    });
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("radio", { name: /Tree/ }));
    const tree = await screen.findByRole("tree", { name: "Note tree" });
    const iconOf = (name: string) =>
      screen.getByRole("treeitem", { name }).querySelector(".tree-icon-box");
    // A custom icon where one is set, else one for the kind of item.
    expect(iconOf("B")).toHaveTextContent("🧪");
    expect(iconOf("A")?.querySelector("svg.lucide-file-text")).not.toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Tree follows" }), {
      target: { value: "folders" },
    });
    expect(iconOf("Dir")).toHaveTextContent("📁");
    expect(iconOf("Vault")?.querySelector("svg.lucide-folder")).not.toBeNull();

    const box = screen.getByRole("checkbox", { name: "Icons" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(tree.querySelector(".tree-icon-box")).toBeNull();
    expect(JSON.parse(localStorage.getItem("axisnotes.graph")!)).toMatchObject({
      display: { icons: false },
    });
  });

  it("draws icons on graph labels by default, with a switch in Display", async () => {
    render(<GraphView />);
    await waitFor(() => expect(h.sigmas.length).toBe(1));
    const sigma = h.sigmas[0]!;
    const draw = sigma.settings.defaultDrawNodeLabel as (
      ctx: CanvasRenderingContext2D,
      data: object,
      settings: object,
    ) => void;
    const texts: [string, number][] = [];
    const ctx = {
      fillText: (t: string, x: number) => texts.push([t, x]),
      drawImage: vi.fn(),
      save() {},
      restore() {},
    } as unknown as CanvasRenderingContext2D;
    const label = { key: "A.md", label: "A", x: 100, y: 50, size: 5 };
    const font = { labelSize: 14, labelFont: "sans-serif", labelWeight: "normal" };
    draw(ctx, label, font);
    // The label makes room for the icon after the node.
    expect(texts).toEqual([["A", 100 + 5 + 3 + 16 + 3]]);

    fireEvent.click(screen.getByRole("button", { name: "Graph settings" }));
    const toggle = screen.getByRole("switch", { name: "Icons" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    texts.length = 0;
    draw(ctx, label, font);
    expect(texts).toEqual([["A", 108]]);
    expect(h.sigmas.length).toBe(1);
  });

  it("leaves room for edge labels and fits the graph back into view", async () => {
    render(<GraphView />);
    await waitFor(() => expect(h.sigmas.length).toBeGreaterThan(0));
    const sigma = h.sigmas.at(-1)!;
    expect(sigma.settings.stagePadding).toBe(72);
    fireEvent.click(screen.getByRole("button", { name: "Fit graph" }));
    expect(sigma.resets).toBe(1);
  });

  it("closes back to the note", async () => {
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("button", { name: "Close graph" }));
    expect(useAppStore.getState().mainView).toBe("note");
  });
});
