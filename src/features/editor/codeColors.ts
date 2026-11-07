// Coloured code: a colour name where a language would go colours the whole code.
//   Inline:  `green`dog2.sit();``
//   Block:   ```green
//            Dog dog2 = new Dog("Hershey", "Rottweiler", 2);
//            ```
// The file keeps exactly what was typed. Other Markdown apps show `green` as inline code
// before the code, or treat the block as one in an unknown language "green".

export const CODE_COLORS = ["green", "yellow", "orange", "red", "violet", "blue"] as const;
export type CodeColor = (typeof CODE_COLORS)[number];

const ALIASES: Record<string, CodeColor> = { purple: "violet" };

/** `green`, `Green` or `purple` (as violet) → the colour; null for anything else. */
export function codeColor(name: string): CodeColor | null {
  const lower = name.trim().split(/\s/)[0]?.toLowerCase() ?? "";
  if ((CODE_COLORS as readonly string[]).includes(lower)) return lower as CodeColor;
  return ALIASES[lower] ?? null;
}

/** The class that colours a code span or a code block's lines. */
export const codeColorClass = (c: CodeColor) => `cm-tint-${c}`;
