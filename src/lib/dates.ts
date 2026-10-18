// Small moment-style date formatting for daily notes and template variables.
// Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H mm ss. Text in [brackets] is literal.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

const TOKENS: Record<string, (d: Date) => string> = {
  YYYY: (d) => String(d.getFullYear()),
  YY: (d) => pad(d.getFullYear() % 100),
  MMMM: (d) => MONTHS[d.getMonth()]!,
  MMM: (d) => MONTHS[d.getMonth()]!.slice(0, 3),
  MM: (d) => pad(d.getMonth() + 1),
  M: (d) => String(d.getMonth() + 1),
  DD: (d) => pad(d.getDate()),
  D: (d) => String(d.getDate()),
  dddd: (d) => DAYS[d.getDay()]!,
  ddd: (d) => DAYS[d.getDay()]!.slice(0, 3),
  HH: (d) => pad(d.getHours()),
  H: (d) => String(d.getHours()),
  mm: (d) => pad(d.getMinutes()),
  ss: (d) => pad(d.getSeconds()),
};

const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g;

export function formatDate(date: Date, format: string): string {
  return format.replace(TOKEN_RE, (m, literal: string | undefined) =>
    literal !== undefined ? literal : TOKENS[m]!(date),
  );
}

/**
 * Parse a date written with `format` (year, month by number or name, and day; other
 * tokens such as weekday names match anything); null if it doesn't match.
 */
export function parseDate(text: string, format: string): Date | null {
  const parts: string[] = [];
  const pattern = format.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(TOKEN_RE, (m, literal) => {
    if (literal !== undefined) return literal;
    if (m === "YYYY") {
      parts.push("Y");
      return "(\\d{4})";
    }
    if (m === "MMMM" || m === "MMM") {
      parts.push(m);
      const names = MONTHS.map((n) => (m === "MMM" ? n.slice(0, 3) : n));
      return `(${names.join("|")})`;
    }
    if (m === "MM" || m === "DD") {
      parts.push(m[0]!);
      return "(\\d{2})";
    }
    if (m === "M" || m === "D") {
      parts.push(m);
      return "(\\d{1,2})";
    }
    return "[^/]*?";
  });
  const match = new RegExp(`^${pattern}$`, "i").exec(text);
  if (!match) return null;
  let y = NaN;
  let mo = NaN;
  let d = NaN;
  parts.forEach((p, i) => {
    const raw = match[i + 1]!;
    const v = Number(raw);
    if (p === "Y") y = v;
    else if (p === "MMMM" || p === "MMM")
      mo = MONTHS.findIndex((n) => n.slice(0, raw.length).toLowerCase() === raw.toLowerCase()) + 1;
    else if (p === "M") mo = v;
    else d = v;
  });
  if ([y, mo, d].some(Number.isNaN)) return null;
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
