// Generated from packs/mattPocock.ts (commit 5863806dd4e15c63174bee4e7515a4256792ecfa): each skill's folder, name and
// description, so the command menu can list them without loading the whole pack.
// collections.test.tsx checks it still matches the pack.

export const MATT_POCOCK_INDEX: { folder: string; name: string; description: string }[] = [
  {
    folder: "ask-matt",
    name: "ask-matt",
    description:
      "Ask which skill or flow fits your situation. A router over the skills in this repo.",
  },
  {
    folder: "code-review",
    name: "code-review",
    description:
      'Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo\'s documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".',
  },
  {
    folder: "codebase-design",
    name: "codebase-design",
    description:
      "Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.",
  },
  {
    folder: "diagnosing-bugs",
    name: "diagnosing-bugs",
    description:
      'Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.',
  },
  {
    folder: "domain-modeling",
    name: "domain-modeling",
    description:
      "Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a GLOSSARY.md, or recording or editing an ADR.",
  },
  {
    folder: "grill-with-docs",
    name: "grill-with-docs",
    description:
      "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.",
  },
  {
    folder: "implement",
    name: "implement",
    description: "Implement a piece of work based on a spec or set of tickets.",
  },
  {
    folder: "implement-spec",
    name: "implement-spec",
    description: "Implement the result of /to-spec and /to-tickets in code.",
  },
  {
    folder: "improve-codebase-architecture",
    name: "improve-codebase-architecture",
    description:
      "Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.",
  },
  { folder: "pr", name: "pr", description: "Use when writing a PR body." },
  {
    folder: "prototype",
    name: "prototype",
    description:
      "Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.",
  },
  {
    folder: "research",
    name: "research",
    description:
      "Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.",
  },
  { folder: "retro", name: "retro", description: "Conduct a retrospective on a coding session." },
  {
    folder: "tdd",
    name: "tdd",
    description:
      'Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.',
  },
  {
    folder: "to-spec",
    name: "to-spec",
    description:
      "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed.",
  },
  {
    folder: "to-tickets",
    name: "to-tickets",
    description:
      "Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).",
  },
  {
    folder: "triage",
    name: "triage",
    description:
      "Move issues and external PRs through a state machine of triage roles, categorise, verify, grill if needed, and write agent-ready briefs.",
  },
  {
    folder: "wayfinder",
    name: "wayfinder",
    description:
      "Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.",
  },
  {
    folder: "wizard",
    name: "wizard",
    description:
      "Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself.",
  },
  {
    folder: "grill-me",
    name: "grill-me",
    description: "A relentless interview to sharpen a plan or design.",
  },
  {
    folder: "grilling",
    name: "grilling",
    description:
      "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.",
  },
  {
    folder: "handoff",
    name: "handoff",
    description:
      "Compact the current conversation into a handoff document for another agent to pick up.",
  },
  {
    folder: "teach",
    name: "teach",
    description: "Teach the user a new skill or concept, within this workspace.",
  },
  {
    folder: "to-questionnaire",
    name: "to-questionnaire",
    description:
      "Turn a decision you can't fully answer into a questionnaire for someone else to fill in.",
  },
  {
    folder: "wait-what",
    name: "wait-what",
    description: "Stop. That last message did not land: re-pitch it.",
  },
  {
    folder: "writing-for-agents",
    name: "writing-for-agents",
    description:
      "Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.",
  },
];
