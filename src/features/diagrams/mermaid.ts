import { useConfig } from "../../app/config";
import { effectiveMode } from "../../app/appearance";

// Mermaid is large, so it is loaded on first use. It runs with `securityLevel: "strict"`:
// labels are sanitized and click handlers/scripts in diagrams are disabled, so rendering
// a note's diagram can't run code.

type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;
let seq = 0;
let theme: "dark" | "default" | null = null;

export const loadMermaid = () =>
  (loading ??= import("mermaid").then((m) => {
    m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
    return m.default;
  }));

export function isDarkTheme(): boolean {
  return effectiveMode(useConfig.getState().config.theme) === "dark";
}

/** The diagram as an SVG string (throws on invalid code). */
export async function renderMermaid(code: string, dark = isDarkTheme()): Promise<string> {
  const mermaid = await loadMermaid();
  const want = dark ? "dark" : "default";
  if (theme !== want) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: want });
    theme = want;
  }
  const { svg } = await mermaid.render(`axis-mermaid-${seq++}`, code);
  return svg;
}

/** Why `code` isn't valid Mermaid, or null if it parses. */
export async function mermaidProblem(code: string): Promise<string | null> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(code);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.split("\n").slice(0, 6).join("\n").trim() || "invalid Mermaid";
  }
}

/** The Mermaid code in a model's reply (code fences and preamble removed). */
export function extractMermaid(reply: string): string {
  const fenced = /```(?:mermaid)?[ \t]*\n([\s\S]*?)\n?```/i.exec(reply);
  let code = (fenced ? fenced[1]! : reply).trim();
  // Drop chatter before the diagram's first keyword line.
  const start = code.search(
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|xychart-beta|block-beta|sankey-beta|requirementDiagram|C4\w*|architecture-beta|kanban|packet-beta|radar-beta|treemap-beta)\b/m,
  );
  if (start > 0) code = code.slice(start);
  return code;
}
