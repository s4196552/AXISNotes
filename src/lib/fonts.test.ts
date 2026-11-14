import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../ipc";
import { fontFaceCss, isFontPath, vaultFonts } from "./fonts";

const file = (path: string): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "file",
  modifiedMs: 0,
});
const dir = (path: string, children: VaultEntry[]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "dir",
  modifiedMs: 0,
  children,
});

describe("fonts imported into the vault", () => {
  it("are the font files in Attachments/Fonts, named after the file", () => {
    const tree = dir("", [
      dir("Attachments", [
        dir("Attachments/Fonts", [
          file("Attachments/Fonts/Lexend.ttf"),
          file("Attachments/Fonts/atkinson Hyperlegible.WOFF2"),
          file("Attachments/Fonts/Lexend.otf"),
          file("Attachments/Fonts/readme.txt"),
        ]),
      ]),
      file("Lost.ttf"),
    ]);
    expect(vaultFonts(tree)).toEqual([
      {
        family: "atkinson Hyperlegible",
        path: "Attachments/Fonts/atkinson Hyperlegible.WOFF2",
        format: "woff2",
      },
      // One family per name: the first file wins.
      { family: "Lexend", path: "Attachments/Fonts/Lexend.ttf", format: "truetype" },
    ]);
    expect(vaultFonts(null)).toEqual([]);
    expect(vaultFonts(dir("", []))).toEqual([]);
    expect(["a.ttf", "b.OTF", "c.woff", "d.woff2", "e.png"].map(isFontPath)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("become @font-face rules, with quotes in names made harmless", () => {
    const css = fontFaceCss(
      [
        { family: 'Odd"Name', path: "Attachments/Fonts/Odd.ttf", format: "truetype" },
        { family: "Gone", path: "x.ttf", format: "truetype" },
      ],
      (path) => (path === "x.ttf" ? null : `http://asset.localhost/${path}`),
    );
    expect(css).toBe(
      '@font-face { font-family: "OddName"; src: url("http://asset.localhost/Attachments/Fonts/Odd.ttf") format("truetype"); font-display: swap; }',
    );
  });
});
