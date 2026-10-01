import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { FeatureBoundary } from "../modules/FeatureBoundary";
import { lazyNamed } from "../../app/lazy";
import { isFeatureEnabled, useFeatureEnabled } from "../modules/features";
import type { DiagramResult } from "../diagrams/DiagramMaker";
const HandwritingDialog = lazyNamed(
  () => import("../handwriting/HandwritingDialog"),
  "HandwritingDialog",
);
const DiagramMaker = lazyNamed(() => import("../diagrams/DiagramMaker"), "DiagramMaker");
import { graphToSkeleton, layoutGraph } from "../../lib/diagram";
import { blobToBase64 } from "../handwriting/pad";
import type { Image } from "../handwriting/recognize";
import { NoteCard } from "./NoteCard";
import { type Lib, loadExcalidraw } from "./loadExcalidraw";
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
  const handwritingEnabled = useFeatureEnabled("handwriting");
  const diagramsEnabled = useFeatureEnabled("diagrams");
  const [lib, setLib] = useState<Lib | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [handwriting, setHandwriting] = useState<{
    image: Image;
    ids: string[];
    box: { x: number; y: number; bottom: number };
  } | null>(null);
  if (!handwritingEnabled && handwriting) setHandwriting(null);
  if (!diagramsEnabled && diagramOpen) setDiagramOpen(false);
  const captureGeneration = useRef(0);
  useEffect(
    () => () => {
      ++captureGeneration.current;
    },
    [handwritingEnabled],
  );
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
    const generation = captureGeneration.current;
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
      const data = await blobToBase64(blob);
      if (generation !== captureGeneration.current || !isFeatureEnabled("handwriting")) return;
      setHandwriting({
        image: { mime: "image/png", data },
        ids: els.map((el) => el.id),
        box: { x, y, bottom },
      });
    } catch (e) {
      if (generation === captureGeneration.current && isFeatureEnabled("handwriting"))
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

  /** Add a generated diagram as shapes and arrows, centered in the view. */
  const addDiagram = (result: DiagramResult) => {
    const a = api.current;
    if (!a || !lib || !("graph" in result)) return;
    const st = a.getAppState();
    const center = lib.viewportCoordsToSceneCoords(
      { clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 },
      st,
    );
    const placed = layoutGraph(result.graph);
    const w = Math.max(...placed.map((n) => n.x + n.width));
    const h = Math.max(...placed.map((n) => n.y + n.height));
    // In the middle of the view, or to the right of what's already there.
    const existing = a.getSceneElements().filter((el) => !el.isDeleted);
    const origin = existing.length
      ? {
          x: Math.max(...existing.map((el) => el.x + el.width)) + 120,
          y: Math.min(...existing.map((el) => el.y)),
        }
      : { x: center.x - w / 2, y: center.y - h / 2 };
    const skeleton = graphToSkeleton(result.graph, origin);
    const els = lib.convertToExcalidrawElements(skeleton as never);
    a.updateScene({
      elements: [...a.getSceneElements(), ...els],
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
        {handwritingEnabled && (
          <button
            className="editor-tool canvas-add-card"
            onClick={() => void convertHandwriting()}
            disabled={!lib || readOnly}
            title="Turn pen strokes (the selection, or all of them) into text with AI"
          >
            <PenLine size={15} /> Convert to text
          </button>
        )}
        {diagramsEnabled && (
          <button
            className="editor-tool canvas-add-card"
            onClick={() => setDiagramOpen(true)}
            disabled={!lib || readOnly}
            title="Make a diagram with AI, or from a note's outline or links"
          >
            <Network size={15} /> Diagram
          </button>
        )}
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
            excalidrawAPI={(a) => (api.current = a)}
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

      {handwritingEnabled && handwriting && (
        <FeatureBoundary name="Handwriting" onDismiss={() => setHandwriting(null)}>
          <Suspense fallback={<p role="status">Loading handwriting…</p>}>
            <HandwritingDialog
              image={handwriting.image}
              sources={hwSources}
              insertLabel="Add to canvas"
              offerReplace
              onInsert={(text, { replace }) => addText(text, replace)}
              onClose={() => setHandwriting(null)}
            />
          </Suspense>
        </FeatureBoundary>
      )}

      {diagramsEnabled && diagramOpen && (
        <FeatureBoundary name="Diagram tools" onDismiss={() => setDiagramOpen(false)}>
          <Suspense fallback={<p role="status">Loading diagram tools…</p>}>
            <DiagramMaker
              target="canvas"
              path={path}
              onInsert={addDiagram}
              onClose={() => setDiagramOpen(false)}
            />
          </Suspense>
        </FeatureBoundary>
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
