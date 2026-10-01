import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { AUTOSAVE_DELAY_MS } from "../files/useFileDocument";
import { serializeCanvas } from "../../lib/canvas";
import { setAiResponder } from "../../ipc/memoryAi";
import { Canvas } from "./Canvas";
import { mergeConfig, useConfig } from "../../app/config";
import * as pad from "../handwriting/pad";

type El = {
  id: string;
  type: string;
  version?: number;
  link?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  isDeleted?: boolean;
};
interface FakeProps {
  initialData: {
    elements: El[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };
  onChange(els: El[], st: Record<string, unknown>, files: Record<string, unknown>): void;
  excalidrawAPI(api: unknown): void;
  renderEmbeddable(el: El): React.ReactNode;
  validateEmbeddable(link: string): boolean | undefined;
  onLinkOpen(el: El, ev: { preventDefault(): void }): void;
  viewModeEnabled?: boolean;
}

const h = vi.hoisted(() => ({
  b: null as unknown as MemoryBackend,
  props: null as FakeProps | null,
  api: null as null | {
    getSceneElements(): El[];
    updateScene(u: { elements: El[] }): void;
  },
  mounts: 0,
  selected: {} as Record<string, boolean>,
  exported: [] as El[][],
  exportGate: null as Promise<Blob> | null,
}));

vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

// Excalidraw needs a real <canvas>; this stand-in keeps a scene and reports changes.
vi.mock("./excalidraw", async () => {
  const React = await import("react");
  const Noop = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const any = new Proxy({}, { get: () => Noop });
  let n = 0;
  function Excalidraw(props: FakeProps) {
    const [scene, setScene] = React.useState<El[]>(props.initialData.elements);
    h.props = props;
    React.useEffect(() => {
      h.mounts++;
      const st = { ...props.initialData.appState };
      const api = {
        getAppState: () => ({
          offsetLeft: 0,
          offsetTop: 0,
          width: 800,
          height: 600,
          selectedElementIds: h.selected,
        }),
        getFiles: () => ({}),
        getSceneElements: () => current,
        updateScene: ({ elements }: { elements: El[] }) => {
          current = elements;
          setScene(elements);
          props.onChange(elements, st, props.initialData.files);
        },
      };
      let current = props.initialData.elements;
      h.api = api;
      props.excalidrawAPI(api);
      props.onChange(current, st, props.initialData.files);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement(
      "div",
      { "data-testid": "excalidraw" },
      scene
        .filter((e) => e.type === "embeddable" && e.link && props.validateEmbeddable(e.link))
        .map((e) => React.createElement("div", { key: e.id }, props.renderEmbeddable(e))),
    );
  }
  return {
    Excalidraw,
    MainMenu: Object.assign(Noop, { DefaultItems: any }),
    WelcomeScreen: Object.assign(Noop, { Hints: any, Center: Object.assign(Noop, any) }),
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
    exportToBlob: ({ elements }: { elements: El[] }) => {
      h.exported.push(elements);
      return h.exportGate ?? Promise.resolve(new Blob(["png"], { type: "image/png" }));
    },
    convertToExcalidrawElements: (els: Omit<El, "id">[]) =>
      els.map((e) => ({ ...e, id: `new${n++}`, version: 1 })),
    getSceneVersion: (els: El[]) => els.reduce((s, e) => s + (e.version ?? 1), 0),
    restoreElements: (els: Omit<El, "id">[]) =>
      els.map((e) => ({ ...e, id: `new${n++}`, version: 1 })),
    viewportCoordsToSceneCoords: (p: { clientX: number; clientY: number }) => ({
      x: p.clientX,
      y: p.clientY,
    }),
  };
});

// As AXIS writes it (pretty-printed), so opening it is not a change.
const BOARD = serializeCanvas({
  elements: [
    { id: "t", type: "text", text: "Plan", version: 1 },
    { id: "c", type: "embeddable", link: "axis:Bio.md", version: 1 },
  ],
  appState: { gridModeEnabled: false },
  files: {},
});

beforeAll(() => {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.b = createMemoryBackend({
    "Board.axcanvas": BOARD,
    "Bio.md": "---\ntags: [x]\n---\n# Cells\n- mitochondria",
    "Ideas.md": "Build AXIS",
  });
  h.mounts = 0;
  h.selected = {};
  h.exported = [];
  h.exportGate = null;
  useConfig.setState({ config: mergeConfig({}) });
  useAppStore.setState({
    error: null,
    activePath: "Board.axcanvas",
    notes: [
      { path: "Bio.md", name: "Bio", title: null, aliases: [] },
      { path: "Ideas.md", name: "Ideas", title: null, aliases: [] },
      { path: "Board.axcanvas", name: "Board.axcanvas", title: "Board", aliases: [] },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setAiResponder(null);
});

const saved = () =>
  JSON.parse(h.b.files()["Board.axcanvas"]!) as { elements: El[]; source: string };

async function open() {
  const utils = render(<Canvas path="Board.axcanvas" />);
  await screen.findByTestId("excalidraw");
  return utils;
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10);
  });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
}

describe("Canvas", () => {
  it("shows note cards as live previews and doesn't rewrite the file on open", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Board" })).toBeInTheDocument();
    expect(await screen.findByText("Cells")).toBeInTheDocument();
    expect(screen.getByText("• mitochondria")).toBeInTheDocument();
    expect(screen.queryByText(/tags/)).toBeNull(); // frontmatter hidden
    await settle();
    expect(h.b.files()["Board.axcanvas"]).toBe(BOARD);
  });

  it("autosaves drawing changes in the Excalidraw format", async () => {
    await open();
    act(() =>
      h.api!.updateScene({
        elements: [...h.api!.getSceneElements(), { id: "ink", type: "freedraw", version: 1 }],
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await settle();
    expect(saved().elements.map((e) => e.id)).toEqual(["t", "c", "ink"]);
    expect(saved().source).toBe("axis");
  });

  it("adds a note card from the picker and opens notes from card links", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Add note card/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("Board"); // only notes can be cards
    fireEvent.click(screen.getByText("Ideas"));
    expect(await screen.findByText("Build AXIS")).toBeInTheDocument();
    await settle();
    const card = saved().elements.find((e) => e.link === "axis:Ideas.md");
    expect(card).toMatchObject({ type: "embeddable", x: 400 - 160, y: 300 - 110 });

    const preventDefault = vi.fn();
    act(() => h.props!.onLinkOpen(card!, { preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
    expect(useAppStore.getState().activePath).toBe("Ideas.md");
  });

  it("reloads the scene when the file changes on disk", async () => {
    await open();
    const next = JSON.parse(BOARD) as { elements: El[] };
    next.elements = [{ id: "only", type: "text", version: 3 }];
    act(() => h.b.externalWrite("Board.axcanvas", JSON.stringify(next)));
    await waitFor(() => expect(h.mounts).toBe(2));
    expect(h.props!.initialData.elements.map((e) => e.id)).toEqual(["only"]);
  });

  it("opens unreadable files read-only and never saves them", async () => {
    h.b = createMemoryBackend({ "Board.axcanvas": "{broken" });
    render(<Canvas path="Board.axcanvas" />);
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add note card/ })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    });
    expect(h.b.files()["Board.axcanvas"]).toBe("{broken");
  });

  it("turns pen strokes into a text element with the handwriting model", async () => {
    vi.useRealTimers();
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    setAiResponder(() => JSON.stringify({ text: "Buy milk", uncertain: [] }));
    try {
      await open();
      const ink = { id: "ink", type: "freedraw", version: 1, x: 10, y: 20, width: 100, height: 40 };
      act(() => h.api!.updateScene({ elements: [...h.api!.getSceneElements(), ink] }));
      fireEvent.click(screen.getByRole("button", { name: /Convert to text/ }));
      expect(await screen.findByLabelText("Transcription")).toHaveTextContent("Buy milk");
      expect(h.exported[0]!.map((e) => e.id)).toEqual(["ink"]); // only the pen strokes
      fireEvent.click(screen.getByLabelText(/Remove the handwriting/));
      fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(
        () =>
          expect(
            saved().elements.find((e) => e.type === "text" && e.text === "Buy milk"),
          ).toBeTruthy(),
        { timeout: 5000 },
      );
      const els = saved().elements;
      expect(els.find((e) => e.text === "Buy milk")).toMatchObject({ x: 10, y: 20 });
      expect(els.find((e) => e.id === "ink")?.isDeleted ?? true).toBe(true);
    } finally {
      setAiResponder(null);
    }
  });

  it("does not resend an old handwriting image when assistance is reenabled", async () => {
    vi.useRealTimers();
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    let requests = 0;
    setAiResponder(() => {
      ++requests;
      return JSON.stringify({ text: "Buy milk", uncertain: [] });
    });
    await open();
    act(() =>
      h.api!.updateScene({
        elements: [
          ...h.api!.getSceneElements(),
          { id: "ink", type: "freedraw", x: 10, y: 20, width: 100, height: 40 },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Convert to text/ }));
    expect(await screen.findByLabelText("Transcription")).toHaveTextContent("Buy milk");
    const original = h.api!.getSceneElements();
    act(() => useConfig.setState({ config: mergeConfig({ features: { aiAssist: false } }) }));
    expect(screen.queryByLabelText("Transcription")).toBeNull();
    await act(async () => useConfig.setState({ config: mergeConfig({}) }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests).toBe(1);
    expect(h.api!.getSceneElements()).toEqual(original);
  });
  it("ignores a handwriting image export that finishes after disable and reenable", async () => {
    vi.useRealTimers();
    vi.spyOn(pad, "blobToBase64").mockResolvedValue("fixture-image");
    let finish!: (value: Blob) => void;
    h.exportGate = new Promise((r) => {
      finish = r;
    });
    await open();
    act(() =>
      h.api!.updateScene({
        elements: [
          ...h.api!.getSceneElements(),
          { id: "ink", type: "freedraw", x: 10, y: 20, width: 100, height: 40 },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Convert to text/ }));
    expect(h.exported).toHaveLength(1);
    act(() => useConfig.setState({ config: mergeConfig({ features: { handwriting: false } }) }));
    act(() => useConfig.setState({ config: mergeConfig({}) }));
    await act(async () => finish(new Blob(["png"])));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.api!.getSceneElements().some((e) => e.id === "ink")).toBe(true);
  });
});
