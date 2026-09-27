// The `.axcanvas` file format: Excalidraw's JSON scene, written in a stable, diff-friendly
// shape. AXISNotes note cards are Excalidraw "embeddable" elements whose `link` is
// `axis:<vault-relative path>`; the app renders them as live note previews.

export const CARD_PREFIX = "axis:";

/** Scene settings kept in the file (the rest of Excalidraw's app state is per-session). */
export interface CanvasAppState {
  viewBackgroundColor?: string;
  gridSize?: number;
  gridStep?: number;
  gridModeEnabled?: boolean;
}

/** Excalidraw elements and files are kept as opaque JSON. */
export type CanvasElement = Record<string, unknown> & { id?: string; type?: string };

export interface CanvasFile {
  type: "excalidraw";
  version: 2;
  source: "axis";
  elements: CanvasElement[];
  appState: CanvasAppState;
  files: Record<string, unknown>;
}

export function emptyCanvas(): CanvasFile {
  return {
    type: "excalidraw",
    version: 2,
    source: "axis",
    elements: [],
    appState: { gridModeEnabled: false },
    files: {},
  };
}

const APP_STATE_KEYS: (keyof CanvasAppState)[] = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
];

function pickAppState(raw: unknown): CanvasAppState {
  const out: CanvasAppState = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of APP_STATE_KEYS) {
    const v = src[k];
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Parse leniently; throws only if the text isn't JSON at all. */
export function parseCanvas(text: string): CanvasFile {
  const file = emptyCanvas();
  if (!text.trim()) return file;
  const raw = JSON.parse(text) as Partial<CanvasFile> | null;
  if (!raw || typeof raw !== "object") throw new Error("not a canvas");
  if (Array.isArray(raw.elements))
    file.elements = raw.elements.filter((e) => e && typeof e === "object");
  file.appState = { ...file.appState, ...pickAppState(raw.appState) };
  if (raw.files && typeof raw.files === "object") file.files = raw.files;
  return file;
}

/**
 * Serialize a scene. Deleted elements are dropped, and so are files no element uses,
 * so the file only holds what is visible.
 */
export function serializeCanvas(scene: {
  elements: readonly CanvasElement[];
  appState: CanvasAppState;
  files: Record<string, unknown>;
}): string {
  const elements = scene.elements.filter((e) => !e.isDeleted);
  const used = new Set(elements.map((e) => e.fileId).filter((id) => typeof id === "string"));
  const files = Object.fromEntries(
    Object.keys(scene.files)
      .filter((id) => used.has(id))
      .sort()
      .map((id) => [id, scene.files[id]]),
  );
  const file: CanvasFile = {
    type: "excalidraw",
    version: 2,
    source: "axis",
    elements,
    appState: pickAppState(scene.appState),
    files,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

export const cardLink = (path: string) => CARD_PREFIX + path;

/** The note path a card element links to, or null for other links. */
export function cardPath(link: string | null | undefined): string | null {
  if (!link?.startsWith(CARD_PREFIX)) return null;
  const path = link.slice(CARD_PREFIX.length).trim();
  return path || null;
}
