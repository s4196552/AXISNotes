// Metadata only: importing the catalog must not import feature implementations.
export const FEATURES = [
  {
    id: "graph",
    label: "Graph views",
    description: "Explore note links. The local graph opens when requested.",
    requires: [],
  },
  {
    id: "timeTracking",
    label: "Time tracking",
    description: "Note/task timers and time reports. Existing time logs are preserved.",
    requires: [],
  },
  {
    id: "aiAssist",
    label: "AI assistance",
    description: "Ask AI and review writing suggestions. Source privacy rules still apply.",
    requires: [],
  },
  {
    id: "handwriting",
    label: "Handwriting recognition",
    description: "Convert pen strokes to text. Requires AI assistance.",
    requires: ["aiAssist"],
  },
  {
    id: "diagrams",
    label: "Diagram tools",
    description: "Render Mermaid and create diagrams from notes; AI generation is optional.",
    requires: [],
  },
] as const;
export type FeatureId = (typeof FEATURES)[number]["id"];
export type FeatureFlags = Record<FeatureId, boolean>;
export const DEFAULT_FEATURES: FeatureFlags = {
  graph: true,
  timeTracking: true,
  aiAssist: true,
  handwriting: true,
  diagrams: true,
};
export function featureEnabled(flags: FeatureFlags, id: FeatureId): boolean {
  const feature = FEATURES.find((f) => f.id === id)!;
  return flags[id] === true && feature.requires.every((dependency) => flags[dependency] === true);
}
