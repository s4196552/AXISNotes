import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { AI_ICON_BAR, AI_ICON_LEGS, AI_ICON_STAR, AiIcon } from "./AiIcon";

it("draws the logo-shaped A and a filled star, sized like the icons beside it", () => {
  const { container } = render(<AiIcon size={15} aria-hidden />);
  const svg = container.querySelector("svg")!;
  expect(svg).toHaveAttribute("width", "15");
  expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  const paths = [...svg.querySelectorAll("path")];
  expect(paths.map((p) => p.getAttribute("d"))).toEqual([AI_ICON_LEGS, AI_ICON_BAR, AI_ICON_STAR]);
  expect(paths[2]).toHaveAttribute("fill", "currentColor");
  // Every point stays inside the 24 × 24 box.
  for (const d of [AI_ICON_LEGS, AI_ICON_BAR, AI_ICON_STAR])
    for (const n of d.match(/\d+(\.\d+)?/g)!.map(Number)) expect(n).toBeLessThanOrEqual(24);
});
