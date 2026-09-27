import type { AiRunRequest } from "../../ipc";
import { InvalidAnswer } from "../../lib/aiJson";
import { MAX_NODES } from "../../lib/diagram";
import { text } from "../ai/runAi";
import { extractMermaid, mermaidProblem } from "./mermaid";

// Prompts for the diagram maker. Notes get Mermaid code (checked with Mermaid's own
// parser); canvases get a JSON graph (checked against GRAPH_SCHEMA + checkGraph). Either
// way an invalid answer is sent back once with the problems (askValidated).

export const MERMAID_KINDS = {
  auto: "Best fit",
  flowchart: "Flowchart",
  mindmap: "Mind map",
  sequence: "Sequence diagram",
  timeline: "Timeline",
  class: "Class diagram",
  state: "State diagram",
  er: "Entity relationship",
  gantt: "Gantt chart",
  pie: "Pie chart",
} as const;
export type MermaidKind = keyof typeof MERMAID_KINDS;

const KEYWORD: Record<Exclude<MermaidKind, "auto">, string> = {
  flowchart: "flowchart",
  mindmap: "mindmap",
  sequence: "sequenceDiagram",
  timeline: "timeline",
  class: "classDiagram",
  state: "stateDiagram-v2",
  er: "erDiagram",
  gantt: "gantt",
  pie: "pie",
};

export function mermaidRequest(prompt: string, kind: MermaidKind, sources: string[]): AiRunRequest {
  const which =
    kind === "auto"
      ? "Pick the Mermaid diagram type that fits best."
      : `Make a ${MERMAID_KINDS[kind].toLowerCase()} (start with \`${KEYWORD[kind]}\`).`;
  return {
    task: "diagrams",
    effort: "balanced",
    sources,
    messages: [
      text(
        "system",
        "You turn descriptions and notes into diagrams written in Mermaid (version 11). " +
          `${which} Keep labels short. Put labels that contain punctuation in double quotes. ` +
          "Reply with only the Mermaid code for one diagram: no explanation and no code fences.",
      ),
      text("user", prompt),
    ],
  };
}

export function graphRequest(
  prompt: string,
  kind: "auto" | "flowchart" | "mindmap",
  sources: string[],
): AiRunRequest {
  const which =
    kind === "auto"
      ? 'Use "mindmap" for a topic broken into parts and "flowchart" for steps, processes or relationships.'
      : `Make a ${kind === "mindmap" ? "mind map" : "flowchart"} (kind "${kind}").`;
  return {
    task: "diagrams",
    effort: "balanced",
    json: true,
    sources,
    messages: [
      text(
        "system",
        "You design diagrams as JSON graphs for a whiteboard. Reply with only a JSON object:\n" +
          '{"kind": "flowchart" | "mindmap", "direction": "down" | "right", ' +
          '"nodes": [{"id": "a", "label": "Short label", "shape": "box" | "round" | "diamond" | "circle"}], ' +
          '"edges": [{"from": "a", "to": "b", "label": "optional"}]}\n' +
          `Rules: ${which} Node ids are unique; every edge uses existing ids; at most ${MAX_NODES} nodes; ` +
          'labels under 40 characters; use "diamond" for decisions. In a mind map the first node is ' +
          "the center, edges go from parent to child, and every node has exactly one parent.",
      ),
      text("user", prompt),
    ],
  };
}

/** Mermaid code from a reply; throws `InvalidAnswer` with the parser's error. */
export async function parseMermaidAnswer(reply: string): Promise<string> {
  const code = extractMermaid(reply);
  if (!code) throw new InvalidAnswer(["the reply has no Mermaid code"]);
  const problem = await mermaidProblem(code);
  if (problem) throw new InvalidAnswer([`Mermaid can't parse it: ${problem}`]);
  return code;
}
