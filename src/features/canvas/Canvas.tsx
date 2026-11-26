import { useEffect, useMemo, useRef, useState } from "react";
import { Network, PenLine, StickyNote } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { effectiveMode } from "../../app/appearance";
import {
  cardLink,
  cardPath,
  type CanvasAppState,
  type CanvasElement,
  type CanvasFile,
  parseCanvas,
  serializeCanvas,
} from "../../lib/canvas";
import { isNotePath } from "../../lib/markdown";
import { PATH_MIME } from "../../lib/fileKinds";
import { Picker } from "../commands/Picker";
import { DocBanner } from "../files/DocBanner";
import { STATUS_TEXT, useFileDocument } from "../files/useFileDocument";
import { HandwritingDialog } from "../handwriting/HandwritingDialog";
import { DiagramMaker, type DiagramResult } from "../diagrams/DiagramMaker";
import { type DiagramGraph, graphToSkeleton, layoutGraph } from "../../lib/diagram";
import { blobToBase64 } from "../handwriting/pad";
import type { Image } from "../handwriting/recognize";
import { NoteCard } from "./NoteCard";
import { type Lib, loadExcalidraw } from "./loadExcalidraw";
import { mergeOutside, needsRemeasure, remeasure } from "./liveMerge";
import "./canvas.css";

type Api = import("./excalidraw").ExcalidrawImperativeAPI;

const CARD_SIZE = { width: 320, height: 220 };

interface Scene {
  elements: readonly CanvasElement[];
  appState: CanvasAppState;
  files: Record<string, unknown>;
}

/** Change tracking for one load of the file (reset when it is reloaded from disk). */
interface Tracking {
  version: number;
  /** Latest scene reported by Excalidraw (null until it first reports). */
  latest: Scene | null;
  /** Scene key of the last change seen, to ignore view-only updates (scroll, selection). */
  lastKey: string | null;
  /** File content on disk as far as we know (last load or save). */
  onDisk: string;
  dirty: boolean;
}

function titleOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.axcanvas$/i, "");
}

export function Canvas({ path }: { path: string }) {
  const [lib, setLib] = useState<Lib | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [handwriting, setHandwriting] = useState<{
    image: Image;
    ids: string[];
    box: { x: number; y: number; bottom: number };
  } | null>(null);
  const api = useRef<Api | null>(null);
  const track = useRef<Tracking | null>(null);

  // Parse the file each time it is (re)loaded from disk.
  const [loaded, setLoaded] = useState<{
    version: number;
    text?: string;
    file?: CanvasFile;
    error?: string;
  }>({ version: 0 });
  // Only called from event handlers and saves, never during render.
  const tracking = (): Tracking => {
    if (track.current?.version !== loaded.version) {
      track.current = {
        version: loaded.version,
        latest: null,
        lastKey: null,
        onDisk: loaded.text ?? "",
        dirty: false,
      };
    }
    return track.current;
  };
  /** A version of the file written outside the app, merged into the open scene (T-293). */
  const absorb = (content: string): boolean => {
    const a = api.current;
    if (!a || !lib || loaded.error !== undefined) return false;
    let next: CanvasFile;
    try {
      next = parseCanvas(content);
    } catch {
      return false; // unreadable: the usual reload shows it read-only
    }
    const t = tracking();
    let previous: CanvasElement[] = [];
    try {
      previous = parseCanvas(t.onDisk).elements;
    } catch {
      /* nothing known about the old version */
    }
    const elements = mergeOutside(
      lib,
      a.getSceneElementsIncludingDeleted() as unknown as CanvasElement[],
      previous,
      next.elements,
      a.getAppState(),
      t.dirty,
    );
    t.onDisk = content;
    const files = Object.values(next.files);
    if (files.length) a.addFiles(files as never);
    a.updateScene({
      elements: elements as never,
      appState: {
        ...(next.appState.viewBackgroundColor
          ? { viewBackgroundColor: next.appState.viewBackgroundColor }
          : {}),
        ...(next.appState.gridSize ? { gridSize: next.appState.gridSize } : {}),
        ...(next.appState.gridStep ? { gridStep: next.appState.gridStep } : {}),
        gridModeEnabled: next.appState.gridModeEnabled ?? false,
      } as never,
      // One undo step, so an outside change (Claude's drawing) can be taken back.
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
    return true;
  };
  const file = useFileDocument(
    path,
    () => {
      const t = tracking();
      const scene = t.latest ?? loaded.file;
      const text = scene ? serializeCanvas(scene) : t.onDisk;
      t.onDisk = text;
      t.dirty = false;
      return text;
    },
    loaded.error === undefined,
    absorb,
  );
  if (file.text !== null && file.loadVersion !== loaded.version) {
    try {
      setLoaded({ version: file.loadVersion, text: file.text, file: parseCanvas(file.text) });
    } catch (e) {
      setLoaded({ version: file.loadVersion, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const { markDirty } = file;

  useEffect(() => {
    let cancelled = false;
    loadExcalidraw().then(
      (l) => !cancelled && setLib(l),
      (e: unknown) => !cancelled && setLibError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const themeSetting = useConfig((s) => s.config.theme);
  const theme = effectiveMode(themeSetting);
  const readOnly = loaded.error !== undefined;

  // Which load of the file Excalidraw has mounted (its API is set then).
  const [mounted, setMounted] = useState(-1);
  // Text written outside the app while the canvas was closed is measured once it shows.
  useEffect(() => {
    const a = api.current;
    if (!lib || !a || mounted !== loaded.version || readOnly) return;
    if (!needsRemeasure(a.getSceneElementsIncludingDeleted() as unknown as CanvasElement[])) return;
    let live = true;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!live || api.current !== a) return;
      const els = a.getSceneElementsIncludingDeleted() as unknown as CanvasElement[];
      a.updateScene({
        elements: remeasure(lib, els) as never,
        captureUpdate: lib.CaptureUpdateAction.NEVER,
      });
    });
    return () => {
      live = false;
    };
  }, [lib, mounted, loaded.version, readOnly]);

  const onChange = (
    elements: readonly CanvasElement[],
    appState: CanvasAppState,
    files: Record<string, unknown>,
  ) => {
    if (!lib) return;
    const t = tracking();
    t.latest = { elements, appState, files };
    const key = [
      lib.getSceneVersion(elements as never),
      Object.keys(files).length,
      appState.viewBackgroundColor,
      appState.gridModeEnabled,
      appState.gridSize,
    ].join("|");
    if (key === t.lastKey) return;
    t.lastKey = key;
    if (readOnly) return;
    // Excalidraw reports the loaded scene (and e.g. re-measured text) as changes; only
    // count it as an edit if the file would actually differ.
    if (!t.dirty && serializeCanvas(t.latest) === t.onDisk) return;
    t.dirty = true;
    markDirty();
  };

  /** Add a note card centered at scene point `at` (default: the middle of the view). */
  const addCard = (notePath: string, at?: { x: number; y: number }) => {
    const a = api.current;
    if (!a || !lib || readOnly) return;
    const st = a.getAppState();
    const center =
      at ??
      lib.viewportCoordsToSceneCoords(
        { clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 },
        st,
      );
    let x = center.x - CARD_SIZE.width / 2;
    let y = center.y - CARD_SIZE.height / 2;
    // Cascade instead of stacking exactly on top of another card.
    const existing = a.getSceneElements();
    while (existing.some((el) => Math.abs(el.x - x) < 8 && Math.abs(el.y - y) < 8)) {
      x += 28;
      y += 28;
    }
    const [card] = lib.restoreElements(
      [
        {
          type: "embeddable",
          x,
          y,
          width: CARD_SIZE.width,
          height: CARD_SIZE.height,
          link: cardLink(notePath),
          roundness: { type: 3 },
          roughness: 0,
        },
      ] as never,
      null,
    );
    a.updateScene({
      elements: [...existing, card!],
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const hwSources = useMemo(() => [path], [path]);

  /** Read the selected strokes (or all pen strokes) with the handwriting model. */
  const convertHandwriting = async () => {
    const a = api.current;
    if (!a || !lib) return;
    const all = a.getSceneElements();
    const selected = a.getAppState().selectedElementIds ?? {};
    let els = all.filter((el) => selected[el.id]);
    if (!els.length) els = all.filter((el) => el.type === "freedraw");
    if (!els.length) {
      useAppStore.getState().notify("Write with the pen (or select handwriting) first.");
      return;
    }
    try {
      const blob = await lib.exportToBlob({
        elements: els,
        appState: {
          ...a.getAppState(),
          exportBackground: true,
          viewBackgroundColor: "#ffffff",
          exportWithDarkMode: false,
        },
        files: a.getFiles(),
        mimeType: "image/png",
        exportPadding: 16,
        maxWidthOrHeight: 1600,
      });
      const x = Math.min(...els.map((el) => el.x));
      const y = Math.min(...els.map((el) => el.y));
      const bottom = Math.max(...els.map((el) => el.y + el.height));
      setHandwriting({
        image: { mime: "image/png", data: await blobToBase64(blob) },
        ids: els.map((el) => el.id),
        box: { x, y, bottom },
      });
    } catch (e) {
      useAppStore.getState().setError(`Couldn't render the handwriting: ${String(e)}`);
    }
  };

  const addText = (text: string, replace: boolean) => {
    const a = api.current;
    if (!a || !lib || !handwriting) return;
    const { box, ids } = handwriting;
    const [el] = lib.convertToExcalidrawElements([
      {
        type: "text",
        x: box.x,
        y: replace ? box.y : box.bottom + 24,
        text,
        fontSize: 20,
      },
    ]);
    const gone = new Set(replace ? ids : []);
    a.updateScene({
      elements: [
        ...a.getSceneElements().map((e) => (gone.has(e.id) ? { ...e, isDeleted: true } : e)),
        el!,
      ],
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /** The diagram being drawn while the model writes it (T-293). */
  const draft = useRef<{ ids: Set<string>; origin: { x: number; y: number } } | null>(null);

  /** Where a diagram goes: in the middle of the view, or to the right of what's there. */
  const diagramOrigin = (
    graph: DiagramGraph,
    existing: readonly { x: number; y: number; width: number; height: number }[],
  ) => {
    const a = api.current!;
    const st = a.getAppState();
    const center = lib!.viewportCoordsToSceneCoords(
      { clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 },
      st,
    );
    const placed = layoutGraph(graph);
    const w = Math.max(...placed.map((n) => n.x + n.width));
    const h = Math.max(...placed.map((n) => n.y + n.height));
    return existing.length
      ? {
          x: Math.max(...existing.map((el) => el.x + el.width)) + 120,
          y: Math.min(...existing.map((el) => el.y)),
        }
      : { x: center.x - w / 2, y: center.y - h / 2 };
  };

  /** Draw (or, with null, remove) the part of a diagram that has arrived. */
  const drawDraft = (graph: DiagramGraph | null) => {
    const a = api.current;
    if (!a || !lib || readOnly) return;
    const prev = draft.current;
    const others = a.getSceneElements().filter((el) => !prev?.ids.has(el.id));
    if (!graph) {
      draft.current = null;
      if (prev)
        a.updateScene({ elements: others, captureUpdate: lib.CaptureUpdateAction.EVENTUALLY });
      return;
    }
    const origin = prev?.origin ?? diagramOrigin(graph, others);
    const els = lib.convertToExcalidrawElements(graphToSkeleton(graph, origin) as never);
    draft.current = { ids: new Set(els.map((el) => el.id)), origin };
    // Not an undo step of its own: undo takes back the finished diagram as a whole.
    a.updateScene({
      elements: [...others, ...els],
      captureUpdate: lib.CaptureUpdateAction.EVENTUALLY,
    });
    a.scrollToContent(els, { fitToContent: true, animate: true, duration: 300 });
  };

  /** Add a generated diagram as shapes and arrows (where its draft was, if it was drawn live). */
  const addDiagram = (result: DiagramResult) => {
    const a = api.current;
    if (!a || !lib || !("graph" in result)) return;
    const prev = draft.current;
    draft.current = null;
    const existing = a.getSceneElements().filter((el) => !el.isDeleted && !prev?.ids.has(el.id));
    const origin = prev?.origin ?? diagramOrigin(result.graph, existing);
    const skeleton = graphToSkeleton(result.graph, origin);
    const els = lib.convertToExcalidrawElements(skeleton as never);
    a.updateScene({
      elements: [...existing, ...els],
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
    a.scrollToContent(els, { fitToContent: true, animate: false });
  };

  const onDrop = (e: React.DragEvent) => {
    const dropped = e.dataTransfer.getData(PATH_MIME);
    if (!dropped || !lib || !api.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isNotePath(dropped)) {
      useAppStore.getState().notify("Only notes can be added as cards.");
      return;
    }
    const st = api.current.getAppState();
    addCard(
      dropped,
      lib.viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st),
    );
  };

  const notes = useAppStore((s) => s.notes);
  const pickItems = useMemo(
    () =>
      notes
        .filter((n) => isNotePath(n.path))
        .map((n) => ({ id: n.path, label: n.title ?? n.name, detail: n.path })),
    [notes],
  );

  const initialData = useMemo(
    () =>
      loaded.file && {
        elements: loaded.file.elements as never,
        appState: { ...loaded.file.appState },
        files: loaded.file.files as never,
        scrollToContent: true,
      },
    [loaded.file],
  );

  const Ex = lib?.Excalidraw;

  return (
    <div className="canvas-view">
      <header className="editor-header canvas-header">
        <h1 className="editor-title">{titleOf(path)}</h1>
        <button
          className="editor-tool canvas-add-card"
          onClick={() => setPicking(true)}
          disabled={!lib || readOnly}
          title="Add a note card (or drag a note from the file tree)"
        >
          <StickyNote size={15} /> Add note card
        </button>
        <button
          className="editor-tool canvas-add-card"
          onClick={() => void convertHandwriting()}
          disabled={!lib || readOnly}
          title="Turn pen strokes (the selection, or all of them) into text with AI"
        >
          <PenLine size={15} /> Convert to text
        </button>
        <button
          className="editor-tool canvas-add-card"
          onClick={() => setDiagramOpen(true)}
          disabled={!lib || readOnly}
          title="Make a diagram with AI, or from a note's outline or links"
        >
          <Network size={15} /> Diagram
        </button>
        <span className={`editor-status status-${file.status}`} role="status" aria-live="polite">
          {STATUS_TEXT[file.status]}
        </span>
      </header>
      <DocBanner doc={file} noun="canvas" />
      {loaded.error !== undefined && (
        <div className="editor-banner" role="alert">
          <span>
            This canvas file could not be read ({loaded.error}). It is shown read-only and will not
            be saved.
          </span>
        </div>
      )}
      {libError && (
        <div className="editor-banner" role="alert">
          <span>The canvas editor failed to load: {libError}</span>
        </div>
      )}

      <div
        className="canvas-host"
        onDragOverCapture={(e) => {
          if (e.dataTransfer.types.includes(PATH_MIME)) e.preventDefault();
        }}
        onDropCapture={onDrop}
      >
        {Ex && initialData ? (
          <Ex
            key={loaded.version}
            initialData={initialData}
            excalidrawAPI={(a) => {
              api.current = a;
              setMounted(loaded.version);
            }}
            onChange={(els, st, files) =>
              onChange(els as readonly CanvasElement[], st, files as Record<string, unknown>)
            }
            theme={theme}
            viewModeEnabled={readOnly}
            name={titleOf(path)}
            validateEmbeddable={(link) => (cardPath(link) ? true : undefined)}
            renderEmbeddable={(el) => {
              const p = cardPath(el.link);
              return p ? <NoteCard path={p} /> : null;
            }}
            onLinkOpen={(el, event) => {
              const p = cardPath(el.link);
              if (!p) return;
              event.preventDefault();
              useAppStore.getState().openFile(p);
            }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                toggleTheme: null,
              },
            }}
          >
            <lib.MainMenu>
              <lib.MainMenu.DefaultItems.SaveAsImage />
              <lib.MainMenu.DefaultItems.ChangeCanvasBackground />
              <lib.MainMenu.DefaultItems.ToggleTheme />
              <lib.MainMenu.DefaultItems.ClearCanvas />
              <lib.MainMenu.DefaultItems.Help />
            </lib.MainMenu>
            <lib.WelcomeScreen>
              <lib.WelcomeScreen.Hints.ToolbarHint />
              <lib.WelcomeScreen.Hints.HelpHint />
              <lib.WelcomeScreen.Center>
                <lib.WelcomeScreen.Center.Heading>
                  Draw, write with a pen, or drag notes here as live cards.
                </lib.WelcomeScreen.Center.Heading>
              </lib.WelcomeScreen.Center>
            </lib.WelcomeScreen>
          </Ex>
        ) : (
          !libError && <div className="empty muted">Loading canvas…</div>
        )}
      </div>

      {handwriting && (
        <HandwritingDialog
          image={handwriting.image}
          sources={hwSources}
          insertLabel="Add to canvas"
          offerReplace
          onInsert={(text, { replace }) => addText(text, replace)}
          onClose={() => setHandwriting(null)}
        />
      )}

      {diagramOpen && (
        <DiagramMaker
          target="canvas"
          path={path}
          onInsert={addDiagram}
          onDraft={drawDraft}
          onClose={() => {
            drawDraft(null); // a draft left by a stopped run
            setDiagramOpen(false);
          }}
        />
      )}

      {picking && (
        <Picker
          title="Add note card"
          placeholder="Find a note…"
          items={pickItems}
          limit={100}
          onClose={() => setPicking(false)}
          onPick={(item) => {
            setPicking(false);
            addCard(item.id);
          }}
        />
      )}
    </div>
  );
}
