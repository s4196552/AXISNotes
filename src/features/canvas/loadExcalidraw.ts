// Excalidraw is large and only needed for canvases, so it is split out and loaded on
// first use. Tests mock `./excalidraw` (it needs a real <canvas>).

export type Lib = typeof import("./excalidraw");

let libPromise: Promise<Lib> | null = null;

export const loadExcalidraw = () => (libPromise ??= import("./excalidraw"));
