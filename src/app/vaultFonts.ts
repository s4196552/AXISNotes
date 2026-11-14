import { backend } from "../ipc";
import { fontFaceCss, type VaultFont } from "../lib/fonts";

const STYLE_ID = "axis-vault-fonts";

/** Make the vault's imported fonts usable by family name (see lib/fonts). */
export function applyVaultFonts(fonts: VaultFont[]) {
  const css = fontFaceCss(fonts, (path) => backend.fileUrl(path));
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  if (tag.textContent !== css) tag.textContent = css;
}
