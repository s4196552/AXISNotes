import type { TaskRef } from "../../ipc";
import { formatDate } from "../../lib/dates";

// Grouping and filtering for the tasks view.

export type Bucket = "overdue" | "today" | "week" | "later" | "none" | "done";

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "Next 7 days" },
  { id: "later", label: "Later" },
  { id: "none", label: "No date" },
  { id: "done", label: "Done" },
];

export const PRIORITY: Record<number, { label: string; mark: string }> = {
  3: { label: "High priority", mark: "⏫" },
  2: { label: "Medium priority", mark: "🔼" },
  1: { label: "Low priority", mark: "🔽" },
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d, "YYYY-MM-DD");
}

export function bucketOf(task: Pick<TaskRef, "done" | "due">, today: string): Bucket {
  if (task.done) return "done";
  if (!task.due) return "none";
  if (task.due < today) return "overdue";
  if (task.due === today) return "today";
  return task.due <= addDays(today, 7) ? "week" : "later";
}

/** Filter terms: plain words match text or path; `tag:x` and `path:x` narrow further. */
export function matchesFilter(task: TaskRef, query: string): boolean {
  const text = task.text.toLowerCase();
  const path = task.path.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => {
      if (term.startsWith("tag:")) {
        const tag = term.slice(4).replace(/^#/, "");
        return new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|\\s|$)`).test(
          text,
        );
      }
      if (term.startsWith("path:")) return path.includes(term.slice(5));
      return text.includes(term) || path.includes(term);
    });
}
