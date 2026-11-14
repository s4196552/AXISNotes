import original from "../assets/logo.svg";
import { backend } from "../ipc";
import { builtinLogoUrl, isLogoPath } from "../features/packs/builtinLogos";

/** Decode only a bundled/vault image; native icon data is bounded to 256×256 RGBA. */
export function applyWindowLogo(logo: string, onError: (message: string) => void): () => void {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  let cancelled = false;
  let image: HTMLImageElement | null = null;
  const url = builtinLogoUrl(logo) ?? (isLogoPath(logo) ? backend.fileUrl(logo) : null) ?? original;
  const decode = (source: string) =>
    new Promise<number[]>((resolve, reject) => {
      image = new window.Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (cancelled) return;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          const context = canvas.getContext("2d");
          if (!context || !image?.naturalWidth || !image.naturalHeight)
            throw new Error("Cannot read logo pixels.");
          const scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
          const width = image.naturalWidth * scale,
            height = image.naturalHeight * scale;
          context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
          resolve(Array.from(context.getImageData(0, 0, 256, 256).data));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error("Could not load the window logo."));
      image.src = source;
    });
  void (async () => {
    try {
      let rgba: number[];
      // Only a logo other than the original needs its own taskbar identity (see taskbar_icon.rs).
      let branded = url !== original;
      try {
        rgba = await decode(url);
      } catch {
        if (cancelled) return;
        rgba = await decode(original);
        branded = false;
      }
      if (!cancelled) await backend.setWindowIcon(rgba, branded);
    } catch (error) {
      if (!cancelled)
        onError(
          `Couldn't change the window icon: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  })();
  return () => {
    cancelled = true;
    if (image) {
      image.onload = image.onerror = null;
      image.src = "";
    }
  };
}
