// The skills that come with AXISNotes. Each is written exactly as a `SKILL.md` file would
// be, so "Copy the built-in skills into the vault" can save them as editable notes that
// any AI tool reading the Agent Skills layout (a folder with a SKILL.md) can also use.

export const BUILTIN_SKILL_FILES: Record<string, string> = {
  mindmap: `---
name: mindmap
title: Mind map
description: Turn a note into a Mermaid mind map you can keep in the note.
output: markdown
reads: note
---
Turn the note you were given into a mind map.

- Reply with one Mermaid \`mindmap\` code block and nothing else: no introduction and no closing remarks.
- The root is the note's main subject, in a few words.
- Use 2 to 4 levels. Group related ideas under one branch, and keep every label short (at most 6 words).
- Labels are plain words. Don't use brackets, parentheses, quotes, colons or Markdown in a label, because they break Mermaid.
- Cover the whole note. Don't add ideas the note doesn't contain.
- If the user adds instructions (a focus, a depth), follow them.
`,

  test: `---
name: test
title: Practice test
description: Make an interactive practice test (HTML) from your notes, with feedback and a score.
output: html
reads: note
---
Write a practice test on the notes you were given, as one self-contained HTML page.

Content
- 10 questions unless the user asks for a different number, ordered from easier to harder.
- Mix multiple choice (4 options, one correct), true/false and short answer.
- Every question checks something the notes actually say. Never invent facts.
- Each question has a one- or two-sentence explanation, shown after the learner answers.

Page
- A title, the number of questions, then one question per card.
- Answering shows right or wrong, the correct answer and the explanation. Short answers are compared case-insensitively against a list of accepted answers.
- At the end, show the score and the questions missed, with a "Try again" button that resets the test and shuffles the order.
- Everything is inline: one <style> and one <script>, no external files, fonts, images or network requests. It must work offline when opened from disk.
- Works with the keyboard (visible focus, Enter submits), readable on a phone, follows the system's light or dark mode.

Reply with only the HTML document, starting with <!doctype html>. No explanation before or after it.
`,

  flashcards: `---
name: flashcards
title: Flash cards
description: Make an interactive flash-card deck (HTML) from your notes.
output: html
reads: note
---
Make a flash-card deck from the notes you were given, as one self-contained HTML page.

Cards
- One card per key fact, term or idea in the notes (usually 10 to 30). The front asks; the back answers in one or two short sentences.
- Only use what the notes say. Never invent facts.

Page
- Show one card at a time. Click, tap or press Space to flip it with a short flip animation.
- Buttons and keys: Previous (←), Next (→), Shuffle, and "Again" / "Got it" to sort the card.
- Show progress, for example "7 of 20 · 5 known". Remember known cards with localStorage, wrapped in try/catch so the page still works without it, and offer "Start over".
- Everything is inline: one <style> and one <script>, no external files, fonts, images or network requests. It must work offline when opened from disk.
- Readable on a phone, follows the system's light or dark mode, visible keyboard focus.

Reply with only the HTML document, starting with <!doctype html>. No explanation before or after it.
`,

  "grill-me": `---
name: grill-me
title: Grill me
description: Get relentlessly interviewed about a plan or design until every branch of the design tree is resolved.
output: chat
reads: note
---
You are a sharp, relentless interviewer. The note you were given describes a plan or a design. Your job is to question the user until every branch of the design tree is resolved.

How to interview
- Keep a design tree in your head: goals, users, scope, constraints, components, data, interfaces, failure cases, security and privacy, cost, rollout, measurement, risks.
- Ask exactly one question per reply, the most important unresolved one, and name the branch it belongs to, for example "Data, storage:".
- Push on vague answers. If an answer is "it depends", "later" or "probably", ask what it depends on, when, and who decides. Point out contradictions with earlier answers or with the note.
- Don't lecture, praise or summarise between questions. One short sentence of context at most, then the question.
- When a branch is resolved, move on. Don't reopen it unless a later answer contradicts it.

Finishing
- When every branch is resolved, or the user says "wrap up", reply with a summary instead of a question:
  - **Decisions**, grouped by branch
  - **Still open**, with who should decide
  - **Risks** to watch
  - **Next steps**, in order
`,

  handoff: `---
name: handoff
title: Handoff
description: Write a handoff document so someone else (a person or another AI) can pick up the work cold.
output: markdown
reads: note
---
Write a handoff document for the work described in the notes you were given, so that someone who has never seen it (a colleague, or another AI model) can continue without asking questions.

Use these sections, in Markdown:

1. **Goal**: what this work is for and what "done" looks like.
2. **Where it stands**: what's finished, what's in progress, what hasn't started.
3. **Decisions made**, and why. Include the options that were ruled out.
4. **Open questions**, and who can answer them.
5. **Next steps**: a numbered list, smallest useful step first.
6. **Know before you start**: gotchas, constraints, deadlines, accounts or tools needed.
7. **Sources**: the notes this came from, as [[wikilinks]].

Be specific and short. Copy exact names, numbers and dates from the notes. Never invent anything: if something is unknown, say so under Open questions. Reply with only the document.
`,

  teach: `---
name: teach
title: Teach me
description: Learn a new skill or concept over several sessions, using this folder as your teaching workspace.
output: files
reads: folder
---
You are a patient, demanding tutor. You teach the user one skill or concept over several sessions. The folder the user started from is your teaching workspace: the notes in it are your memory between sessions.

Each session
1. Read the workspace notes you were given.
   - If there is a "Progress.md", continue from it: review what was covered, the learner's level and their mistakes, then teach the next step.
   - If there isn't one, this is the first session. Work out the topic from the user's message (or from the notes), then plan a short curriculum of 5 to 10 lessons, from basics to real use.
2. Teach one lesson. It builds on the last and fixes earlier misunderstandings.
3. Write or update these files:
   - "Progress.md": the topic, the curriculum as a checklist (- [x] for done lessons), the learner's current level, mistakes to revisit, and what the next session should start with. Rewrite the whole file each time.
   - "Lesson N - <short title>.md": the lesson, with a clear explanation, one worked example, and 3 to 5 exercises from easy to hard. Put the answers at the end, under a heading "Answers".
   - "Lesson N - <short title>.html": an interactive practice page for the same lesson that checks the learner's answers and explains mistakes. One self-contained file with inline CSS and JavaScript, no external files or network requests, readable on a phone, following light or dark mode.

Reply with one JSON object and nothing else:
{"message": "<2 or 3 sentences to the learner: what this session covers and what to do next>", "files": [{"path": "Progress.md", "content": "..."}, {"path": "Lesson 1 - Basics.md", "content": "..."}, {"path": "Lesson 1 - Basics.html", "content": "..."}]}

Paths are relative to the workspace folder: plain file names, no folders, ending in .md or .html.
`,
};
