// Spreadsheet formula parser (Pratt). Handles numbers, strings, booleans, A1 references
// (with $), ranges, names (for note properties), unary/binary operators with Excel
// precedence, percent, and function calls (dotted names like BETA.DIST).

export type Node =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "ref"; col: number; row: number }
  | { type: "range"; from: { col: number; row: number }; to: { col: number; row: number } }
  | { type: "name"; name: string }
  | { type: "unary"; op: "-" | "+" | "%"; arg: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

export class FormulaSyntaxError extends Error {}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

const REF_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

/** Column letters → 0-based index (A=0, Z=25, AA=26). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0-based index → column letters. */
export function colName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function parseRef(text: string): { col: number; row: number } | null {
  const m = REF_RE.exec(text);
  if (!m) return null;
  const row = Number(m[2]) - 1;
  return row >= 0 ? { col: colIndex(m[1]!), row } : null;
}

export function refName(col: number, row: number): string {
  return `${colName(col)}${row + 1}`;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError(`Bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaSyntaxError("Unterminated string");
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ t: "str", v: s });
    } else if (/[A-Za-z_$\p{L}]/u.test(ch)) {
      const m = /^[A-Za-z_$\p{L}][\w$.\p{L}]*/u.exec(src.slice(i))!;
      out.push({ t: "ident", v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (["<=", ">=", "<>"].includes(two)) {
        out.push({ t: "op", v: two });
        i += 2;
      } else if ("+-*/^&=<>(),:%;".includes(ch)) {
        out.push({ t: "op", v: ch === ";" ? "," : ch });
        i++;
      } else {
        throw new FormulaSyntaxError(`Unexpected "${ch}"`);
      }
    }
  }
  out.push({ t: "eof" });
  return out;
}

// Binding powers, Excel order: comparison < & < +- < */ < ^ < unary/percent.
const INFIX: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

export function parseFormula(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const expectOp = (v: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new FormulaSyntaxError(`Expected "${v}"`);
  };

  const primary = (): Node => {
    const t = next();
    switch (t.t) {
      case "num":
        return { type: "num", value: t.v };
      case "str":
        return { type: "str", value: t.v };
      case "op":
        if (t.v === "(") {
          const e = expr(0);
          expectOp(")");
          return e;
        }
        if (t.v === "-" || t.v === "+") return { type: "unary", op: t.v, arg: expr(6) };
        throw new FormulaSyntaxError(`Unexpected "${t.v}"`);
      case "ident": {
        const up = t.v.toUpperCase();
        const after = peek();
        if (after.t === "op" && after.v === "(") {
          next();
          const args: Node[] = [];
          if (!(peek().t === "op" && (peek() as { v: string }).v === ")")) {
            for (;;) {
              args.push(expr(0));
              const sep = next();
              if (sep.t === "op" && sep.v === ")") break;
              if (!(sep.t === "op" && sep.v === ","))
                throw new FormulaSyntaxError("Expected , or )");
            }
          } else {
            next();
          }
          return { type: "call", name: up, args };
        }
        if (up === "TRUE" || up === "FALSE") return { type: "bool", value: up === "TRUE" };
        const ref = parseRef(t.v);
        if (ref) {
          const colon = peek();
          if (colon.t === "op" && colon.v === ":") {
            next();
            const end = next();
            const to = end.t === "ident" ? parseRef(end.v) : null;
            if (!to) throw new FormulaSyntaxError("Bad range");
            return { type: "range", from: ref, to };
          }
          return { type: "ref", ...ref };
        }
        return { type: "name", name: t.v };
      }
      default:
        throw new FormulaSyntaxError("Unexpected end of formula");
    }
  };

  const expr = (minBp: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t.t !== "op") break;
      if (t.v === "%") {
        next();
        left = { type: "unary", op: "%", arg: left };
        continue;
      }
      const bp = INFIX[t.v];
      if (bp === undefined || bp < minBp) break;
      next();
      // ^ is right-associative; everything else left-associative.
      const right = expr(t.v === "^" ? bp : bp + 1);
      left = { type: "binary", op: t.v, left, right };
    }
    return left;
  };

  const root = expr(0);
  if (peek().t !== "eof") throw new FormulaSyntaxError("Unexpected text after formula");
  return root;
}
