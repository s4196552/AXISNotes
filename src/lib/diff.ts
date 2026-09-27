// Word-level diff for reviewing AI edits: lines are diffed first, then the words of
// changed lines, so long notes stay fast. Each change can be accepted or rejected.

export type Segment =
  { kind: "same"; text: string } | { kind: "change"; id: number; before: string; after: string };

type Op = { kind: "same" | "del" | "ins"; text: string };

/** Largest LCS table we build (cells); bigger blocks become one replacement. */
const MAX_CELLS = 4_000_000;

function lcs(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: Op[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  let mid: Op[];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    mid = [
      ...x.map((text): Op => ({ kind: "del", text })),
      ...y.map((text): Op => ({ kind: "ins", text })),
    ];
  } else {
    // table[i][j] = LCS length of x[i..] and y[j..].
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * w + j] =
          x[i] === y[j]
            ? table[(i + 1) * w + j + 1]! + 1
            : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        mid.push({ kind: "same", text: x[i++]! });
        j++;
      } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) {
        mid.push({ kind: "del", text: x[i++]! });
      } else {
        mid.push({ kind: "ins", text: y[j++]! });
      }
    }
    while (i < n) mid.push({ kind: "del", text: x[i++]! });
    while (j < m) mid.push({ kind: "ins", text: y[j++]! });
  }
  return [...head, ...mid, ...tail];
}

const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const words = (s: string) => s.match(/\s+|[\p{L}\p{N}\p{M}'’_-]+|[^\s\p{L}\p{N}\p{M}]/gu) ?? [];

/** Diff two texts into unchanged runs and numbered changes. */
export function diffWords(before: string, after: string): Segment[] {
  const ops: Op[] = [];
  const lineOps = lcs(lines(before), lines(after));
  // Re-diff each run of changed lines word by word.
  for (let k = 0; k < lineOps.length;) {
    if (lineOps[k]!.kind === "same") {
      ops.push(lineOps[k++]!);
      continue;
    }
    let del = "";
    let ins = "";
    while (k < lineOps.length && lineOps[k]!.kind !== "same") {
      const op = lineOps[k++]!;
      if (op.kind === "del") del += op.text;
      else ins += op.text;
    }
    ops.push(...lcs(words(del), words(ins)));
  }

  // Group into segments; changes separated only by a single space are merged.
  const out: Segment[] = [];
  let id = 0;
  let change: { before: string; after: string } | null = null;
  let gap = "";
  const flush = () => {
    if (change) out.push({ kind: "change", id: id++, ...change });
    change = null;
  };
  const same = (text: string) => {
    const last = out.at(-1);
    if (last?.kind === "same") last.text += text;
    else out.push({ kind: "same", text });
  };
  for (const op of ops) {
    if (op.kind === "same") {
      if (change && gap === "" && op.text === " ") {
        gap = op.text;
        continue;
      }
      flush();
      if (gap) same(gap);
      gap = "";
      same(op.text);
      continue;
    }
    if (!change) change = { before: "", after: "" };
    else if (gap) {
      change.before += gap;
      change.after += gap;
      gap = "";
    }
    if (op.kind === "del") change.before += op.text;
    else change.after += op.text;
  }
  flush();
  if (gap) same(gap);
  return out;
}

/** The text with every change applied except the `rejected` ones. */
export function applySegments(segments: Segment[], rejected: ReadonlySet<number>): string {
  return segments
    .map((s) => (s.kind === "same" ? s.text : rejected.has(s.id) ? s.before : s.after))
    .join("");
}

export function changeCount(segments: Segment[]): number {
  return segments.filter((s) => s.kind === "change").length;
}
