import { describe, expect, it } from "vitest";
import { findTasks, parseTaskLine, setTaskDone } from "./tasks";

const task = (line: string) => parseTaskLine(line, 1);

describe("tasks", () => {
  // Same cases as src-tauri/src/index/tasks.rs, so both parsers agree.
  it("recognizes checkbox list items", () => {
    expect(task("- [ ] a")).not.toBeNull();
    expect(task("  * [x] a")?.done).toBe(true);
    expect(task("3. [X] a")?.done).toBe(true);
    expect(task("+ [ ]")).not.toBeNull();
    for (const no of [
      "- [-] cancelled",
      "[ ] not a list",
      "- [ ]no space",
      "-[ ] no space",
      "- plain",
    ])
      expect(task(no)).toBeNull();
  });

  it("extracts due dates, priorities and clean text", () => {
    expect(task("- [ ] Call Bob 📅 2026-10-01 ⏫ #work ^abc123")).toMatchObject({
      text: "Call Bob #work",
      due: "2026-10-01",
      priority: 3,
    });
    expect(task("- [x] Pay rent due:2026-09-30 🔼 ✅ 2026-09-29")).toMatchObject({
      text: "Pay rent",
      due: "2026-09-30",
      priority: 2,
    });
    expect(task("- [ ] odd 📅 soon due:notadate")).toMatchObject({
      text: "odd 📅 soon due:notadate",
      due: null,
      priority: 0,
    });
  });

  it("finds tasks with file line numbers, skipping frontmatter and code", () => {
    const text = "---\nlist:\n- [ ] not a task\n---\n- [ ] one\n```\n- [ ] code\n```\n- [x] two";
    expect(findTasks(text).map((t) => [t.line, t.text])).toEqual([
      [5, "one"],
      [9, "two"],
    ]);
  });

  it("stamps and clears the done date when toggling", () => {
    const done = setTaskDone("  - [ ] Ship 📅 2026-10-02 ^b1", true, "2026-09-26");
    expect(done).toBe("  - [x] Ship 📅 2026-10-02 ✅ 2026-09-26 ^b1");
    expect(setTaskDone(done, false, "2026-09-27")).toBe("  - [ ] Ship 📅 2026-10-02 ^b1");
    expect(setTaskDone("1. [ ] x", true, "2026-09-26")).toBe("1. [x] x ✅ 2026-09-26");
    expect(setTaskDone("not a task", true, "2026-09-26")).toBe("not a task");
  });
});
