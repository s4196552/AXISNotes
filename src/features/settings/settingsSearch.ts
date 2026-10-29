// Search settings: which rendered settings match a query (used by Settings.tsx).

/** The settings a search can show or hide one by one: rows, list items, checkboxes. */
const UNIT = ".settings-field, li, .settings-checks > label, .clipper-row, .updates-row";
export const HIDDEN = "settings-search-hidden";

export const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
export const hasAll = (words: string[], text: string) => {
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
};

/**
 * Show only the settings in `root` that match every word: by their own text, the heading
 * of their group, the label of the setting holding them, or their section's name. Returns
 * whether anything is left.
 */
export function filterSettings(root: HTMLElement, words: string[]): boolean {
  let any = false;
  for (const sec of root.querySelectorAll<HTMLElement>(".settings-search-section")) {
    if (sec.dataset.live !== undefined) {
      any ||= !sec.classList.contains(HIDDEN);
      continue;
    }
    const body = sec.querySelector<HTMLElement>(".settings-search-body")!;
    const whole = hasAll(words, sec.dataset.label ?? "");
    const all = [...body.querySelectorAll<HTMLElement>(UNIT)];
    const leaves = all.filter((u) => !u.querySelector(UNIT));
    const heading = (el: HTMLElement) => {
      const group = el.parentElement?.closest("section");
      return group && body.contains(group) ? (group.querySelector("h3")?.textContent ?? "") : "";
    };
    if (leaves.length === 0) {
      const show = whole || hasAll(words, body.textContent ?? "");
      body.classList.toggle(HIDDEN, !show);
      sec.classList.toggle(HIDDEN, !show);
      any ||= show;
      continue;
    }
    body.classList.remove(HIDDEN);
    for (const u of leaves) {
      const show = whole || hasAll(words, `${u.textContent ?? ""} ${heading(u)}`);
      u.classList.toggle(HIDDEN, !show);
    }
    // A setting whose own label matches shows everything in it (all its checkboxes).
    for (const u of all.filter((x) => !leaves.includes(x))) {
      const label = [".settings-label", ".settings-hint"]
        .map((s) => u.querySelector(s)?.textContent ?? "")
        .join(" ");
      if (whole || hasAll(words, `${label} ${heading(u)}`))
        u.querySelectorAll(UNIT).forEach((x) => x.classList.remove(HIDDEN));
    }
    // Then hide whatever holds no visible setting: outer settings, groups and lists.
    for (const holder of body.querySelectorAll<HTMLElement>(`${UNIT}, section, ul, ol`)) {
      if (leaves.includes(holder)) continue;
      const visible = [...holder.querySelectorAll(UNIT)].some(
        (x) => !x.querySelector(UNIT) && !x.classList.contains(HIDDEN),
      );
      holder.classList.toggle(HIDDEN, !visible);
    }
    const visible = leaves.some((u) => !u.classList.contains(HIDDEN));
    sec.classList.toggle(HIDDEN, !visible);
    any ||= visible;
  }
  return any;
}
