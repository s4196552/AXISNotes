import { create } from "zustand";
import type { AgentState } from "../../ipc";

// The images the user picked for the Agent's states, kept on this device in the webview's
// IndexedDB (the main window and the Agent's window load the same app, so both can read
// them). The main window only tells the Agent's window which version to load, never the
// image data itself. Animated GIF, WebP and APNG files play as they are; a sprite strip
// (frames side by side) plays at the chosen speed.

export interface StoredImage {
  blob: Blob;
  name: string;
  /** Frames side by side in the image; 1 = a single picture. */
  frames: number;
  /** Frames per second for a sprite strip. */
  fps: number;
}

/** What the Agent draws for a state. */
export interface AgentImage {
  url: string;
  frames: number;
  fps: number;
}

export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/apng",
  "image/svg+xml",
];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FRAME_LIMITS = { min: 1, max: 64 } as const;
export const FPS_LIMITS = { min: 1, max: 30 } as const;

/** Why a file can't be used, or null if it can. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Use a PNG, JPG, GIF, WebP, APNG or SVG image.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is over 8 MB. Use a smaller one.";
  return null;
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

export const clampFrames = (n: number) => clamp(n, FRAME_LIMITS.min, FRAME_LIMITS.max);
export const clampFps = (n: number) => clamp(n, FPS_LIMITS.min, FPS_LIMITS.max);

// ---- Storage ----

const DB_NAME = "axis-agent";
const STORE = "images";
const VERSION_KEY = "axis.agent.imagesVersion";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("No storage for images."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open image storage."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Image storage failed."));
    });
  } finally {
    db.close();
  }
}

export async function readImages(): Promise<Partial<Record<AgentState, StoredImage>>> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const out: Partial<Record<AgentState, StoredImage>> = {};
        const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve(out);
          out[c.key as AgentState] = c.value as StoredImage;
          c.continue();
        };
        req.onerror = () => reject(req.error ?? new Error("Image storage failed."));
      });
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

export async function putImage(state: AgentState, image: StoredImage) {
  await withStore("readwrite", (s) => s.put(image, state));
  bumpImagesVersion();
}

export async function deleteImage(state: AgentState) {
  await withStore("readwrite", (s) => s.delete(state));
  bumpImagesVersion();
}

export async function clearImages() {
  await withStore("readwrite", (s) => s.clear());
  bumpImagesVersion();
}

// ---- Which version of the images is current (shared by both windows) ----

function storedVersion(): number {
  try {
    return Number(localStorage.getItem(VERSION_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** The current images' version: the main window sends it, the Agent's window loads it. */
export const useAgentImagesVersion = create<{ version: number }>(() => ({
  version: storedVersion(),
}));

function bumpImagesVersion() {
  const version = Math.max(storedVersion(), useAgentImagesVersion.getState().version) + 1;
  try {
    localStorage.setItem(VERSION_KEY, String(version));
  } catch {
    // Without storage the version still changes in this window.
  }
  useAgentImagesVersion.setState({ version });
}

// ---- Loaded images, as object URLs, in whichever window draws the Agent ----

interface Loaded {
  version: number | null;
  images: Partial<Record<AgentState, AgentImage>>;
}

export const useAgentImageUrls = create<Loaded>(() => ({ version: null, images: {} }));

let loading: number | null = null;

/** Load the images for `version` (once), replacing the previous object URLs. */
export async function loadAgentImages(version: number) {
  if (useAgentImageUrls.getState().version === version || loading === version) return;
  loading = version;
  const stored = await readImages();
  if (loading !== version) return; // a newer version started loading
  loading = null;
  for (const img of Object.values(useAgentImageUrls.getState().images))
    if (img) URL.revokeObjectURL(img.url);
  const images: Partial<Record<AgentState, AgentImage>> = {};
  for (const [state, img] of Object.entries(stored) as [AgentState, StoredImage][])
    images[state] = { url: URL.createObjectURL(img.blob), frames: img.frames, fps: img.fps };
  useAgentImageUrls.setState({ version, images });
}
