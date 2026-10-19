import { describe, expect, it } from "vitest";
import { svgIsMonochrome } from "./svgMonochrome";

// The same cases as `tells_one_colour_svgs_from_coloured_ones` in src-tauri/src/packs.rs.
describe("svgIsMonochrome", () => {
  it("tells one-colour SVGs from coloured ones", () => {
    expect(
      svgIsMonochrome('<svg fill="none" stroke="currentColor" stroke-width="2"><path/></svg>'),
    ).toBe(true);
    expect(svgIsMonochrome('<svg><path d="M1 1"/></svg>')).toBe(true);
    expect(
      svgIsMonochrome('<svg style="fill: #000000 !important"><path fill-opacity=".5"/></svg>'),
    ).toBe(true);
    expect(svgIsMonochrome('<svg><path fill="#e5484d"/></svg>')).toBe(false);
    expect(svgIsMonochrome('<svg><path style="stroke:rgb(1, 2, 3)"/></svg>')).toBe(false);
    expect(svgIsMonochrome('<svg><stop stop-color="#fff"/><path fill="url(#g)"/></svg>')).toBe(
      false,
    );
  });
});
