/**
 * Score how well `query` matches `text` as an in-order subsequence (case-insensitive).
 * 0 = no match. Contiguous runs, word starts and early matches score higher.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  const direct = t.indexOf(q);
  if (direct !== -1) {
    const wordStart = direct === 0 || /[\s/_\-.]/.test(t[direct - 1]!);
    return 1000 - direct + (wordStart ? 200 : 0) + (t.length === q.length ? 300 : 0);
  }
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    run = found === ti ? run + 1 : 1;
    const wordStart = found === 0 || /[\s/_\-.]/.test(t[found - 1]!);
    score += 10 + run * 5 + (wordStart ? 15 : 0) - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return Math.max(1, score);
}
