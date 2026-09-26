/** Render `text` with segments between `start` and `end` markers as <mark>. */
export function Highlighted({ text, start, end }: { text: string; start: string; end: string }) {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const s = rest.indexOf(start);
    if (s === -1) {
      parts.push(rest);
      break;
    }
    const e = rest.indexOf(end, s + start.length);
    if (e === -1) {
      parts.push(rest.replaceAll(start, ""));
      break;
    }
    if (s > 0) parts.push(rest.slice(0, s));
    parts.push(<mark key={key++}>{rest.slice(s + start.length, e)}</mark>);
    rest = rest.slice(e + end.length);
  }
  return <>{parts}</>;
}
