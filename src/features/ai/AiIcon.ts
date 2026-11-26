import { createLucideIcon } from "lucide-react";

// The AI symbol used everywhere in AXISNotes (T-292): a line-drawn letter A in the shape
// of the AXISNotes logo (curved legs meeting at a sharp peak, a crossbar that bows up
// like the logo's base) with a small four-point star. A Lucide icon, so it takes the same
// props (size, strokeWidth, className, aria-*) as the icons it sits next to.

/** The A's legs: the logo's two sides, flaring at the feet. */
export const AI_ICON_LEGS = "M2.5 21C7.2 16.6 9.5 13 9.5 5.5C9.5 13 11.8 16.6 16.5 21";
/** The crossbar: bows upward like the logo's base. */
export const AI_ICON_BAR = "M6.8 16Q9.5 14.2 12.2 16";
/** The star, filled so its points stay crisp at 12–16 px. */
export const AI_ICON_STAR =
  "M19 1.8C19 4 19.9 5 22.2 5C19.9 5 19 6 19 8.2C19 6 18.1 5 15.8 5C18.1 5 19 4 19 1.8Z";

export const AiIcon = createLucideIcon("axis-ai", [
  ["path", { d: AI_ICON_LEGS, key: "legs" }],
  ["path", { d: AI_ICON_BAR, key: "bar" }],
  [
    "path",
    {
      d: AI_ICON_STAR,
      key: "star",
      fill: "currentColor",
      strokeWidth: 1,
      strokeLinejoin: "round",
    },
  ],
]);
