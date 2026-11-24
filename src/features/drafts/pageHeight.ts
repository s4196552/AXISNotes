export const DEFAULT_PAGE_HEIGHT = 480;

/** A height from the embed's `|number`, kept to something that fits a note. */
export const pageHeight = (n: number | null) =>
  n === null ? DEFAULT_PAGE_HEIGHT : Math.min(2000, Math.max(120, Math.round(n)));
