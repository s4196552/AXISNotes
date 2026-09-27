// Example notes for a new vault (optional). They show the main features by example and
// can be deleted like any other note.

export const STARTER_NOTES: Record<string, string> = {
  "Start here.md": `---
tags: [axis/guide]
---
# Start here

Welcome to **AXIS**. Your notes are plain Markdown files in this folder, so they're
yours: open them in any editor, sync them however you like, and they still work.

## The basics

- **Ctrl+N** new note · **Ctrl+O** find a note · **Ctrl+P** every command
- Type \`/\` in a note for headings, tables, templates, diagrams and more; \`:\` for emoji.
- Link notes with \`[[\`: try [[Tasks and dates]] or [[Diagrams]]. The note you link to
  lists this one under *Backlinks*.
- Tags like #axis/guide group notes; nested tags such as #work/projects work too.

## Beyond notes

- **Grids** (spreadsheets with formulas) and **canvases** (an infinite whiteboard with
  note cards and pen input): Ctrl+P → "New grid" or "New canvas".
- **Daily notes**: Ctrl+Shift+D, or the calendar on the right.
- **Tasks** from every note: Ctrl+Shift+T. **Graph** of your links: Ctrl+G.

## Optional extras

- **AI** with your own API key or a local model: Settings → AI. It powers Ask AI
  (Ctrl+J), grammar fixes, handwriting to text and the diagram maker. Folders can be
  marked "AI: never".
- **Web clipper**: save pages from your browser. Settings → Web clipper.
- **Coming from Obsidian?** Ctrl+P → "Import from Obsidian…", or just open your Obsidian
  vault in AXIS.

> [!tip] Make it yours
> Themes, fonts, folder icons and keyboard shortcuts are in Settings (Ctrl+,).
`,
  "Examples/Tasks and dates.md": `# Tasks and dates

Checkboxes anywhere in your vault show up in the *Tasks* view.

- [ ] Try the tasks view (Ctrl+Shift+T) 📅 2030-01-01 ⏫
- [ ] Add a due date with \`/due\` and a priority with \`/priority\`
- [x] Open this example

Back to [[Start here]].
`,
  "Examples/Diagrams.md": `# Diagrams

Diagrams are written in Mermaid and drawn as you type. Put the cursor in one to edit it,
or type \`/diagram\` to make one from a description or from a note's outline.

\`\`\`mermaid
flowchart LR
  A[Write notes] --> B[Link them]
  B --> C[See the graph]
\`\`\`

Back to [[Start here]].
`,
  "Templates/Meeting.md": `---
date: {{date}}
---
# {{prompt:Meeting topic}}

## Notes

- {{cursor}}

## Action items

- [ ]
`,
};
