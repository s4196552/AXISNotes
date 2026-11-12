export const MIN_DIAGRAM_WIDTH = 24;
export const MAX_DIAGRAM_WIDTH = 9999;

export const isMermaidInfo = (info: string) => /^mermaid(?:\s|$)/i.test(info.trim());

const widthToken = /(^|[ \t])width=(\S*)/i;

export function diagramWidth(info: string): number | null {
  const width = Number(widthToken.exec(info)?.[2]);
  return Number.isInteger(width) && width >= MIN_DIAGRAM_WIDTH && width <= MAX_DIAGRAM_WIDTH
    ? width
    : null;
}

/** Keep the original language and other fence attributes. */
export function setDiagramWidth(info: string, width: number): string {
  const token = `width=${width}`;
  if (widthToken.test(info))
    return info.replace(widthToken, (_match, space: string) => space + token);
  return info.trimEnd() + " " + token;
}
