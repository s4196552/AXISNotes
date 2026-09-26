// The only module that imports Excalidraw. It is loaded lazily (it's large) and is the
// seam tests mock, since Excalidraw needs a real <canvas>.
import "@excalidraw/excalidraw/index.css";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Fonts are served by the app (see vite.config.ts), never fetched from a CDN.
window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw-assets/`;

export {
  CaptureUpdateAction,
  Excalidraw,
  getSceneVersion,
  MainMenu,
  restoreElements,
  viewportCoordsToSceneCoords,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
export type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
export type {
  ExcalidrawElement,
  NonDeleted,
  ExcalidrawEmbeddableElement,
} from "@excalidraw/excalidraw/element/types";
