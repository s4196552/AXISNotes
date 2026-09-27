// Getting structured answers out of language models: pull the JSON out of the reply
// (models add code fences or a sentence of preamble), then check it against a small
// schema. The error messages are written to be sent back to the model for one retry.

export type Schema =
  | { type: "string"; enum?: readonly string[]; optional?: boolean }
  | { type: "number"; optional?: boolean }
  | { type: "boolean"; optional?: boolean }
  | { type: "array"; items: Schema; min?: number; max?: number; optional?: boolean }
  | { type: "object"; props: Record<string, Schema>; optional?: boolean };

/** The answer didn't have the expected shape; `problems` explain why. */
export class InvalidAnswer extends Error {
  constructor(readonly problems: string[]) {
    super(problems.slice(0, 5).join("; "));
    this.name = "InvalidAnswer";
  }
}

/** Parse the first JSON object or array in `text`. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    // Fall through: look for the outermost {...} or [...].
  }
  const start = body.search(/[[{]/);
  const open = body[start];
  const end = body.lastIndexOf(open === "[" ? "]" : "}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch (e) {
      throw new InvalidAnswer([`the reply is not valid JSON (${(e as Error).message})`]);
    }
  }
  throw new InvalidAnswer(["the reply does not contain a JSON object"]);
}

const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** Problems with `value` against `schema` (empty = valid). */
export function validate(value: unknown, schema: Schema, at = "$"): string[] {
  if (value === undefined || value === null) {
    return schema.optional ? [] : [`${at} is missing`];
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return [`${at} must be a string, not ${kind(value)}`];
      if (schema.enum && !schema.enum.includes(value))
        return [`${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`];
      return [];
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? []
        : [`${at} must be a number, not ${kind(value)}`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at} must be true or false`];
    case "array": {
      if (!Array.isArray(value)) return [`${at} must be an array, not ${kind(value)}`];
      const out: string[] = [];
      if (schema.min !== undefined && value.length < schema.min)
        out.push(`${at} needs at least ${schema.min} item(s)`);
      if (schema.max !== undefined && value.length > schema.max)
        out.push(`${at} can have at most ${schema.max} items`);
      value.forEach((v, i) => out.push(...validate(v, schema.items, `${at}[${i}]`)));
      return out;
    }
    case "object": {
      if (kind(value) !== "object") return [`${at} must be an object, not ${kind(value)}`];
      const obj = value as Record<string, unknown>;
      return Object.entries(schema.props).flatMap(([k, s]) => validate(obj[k], s, `${at}.${k}`));
    }
  }
}

/** Extract and validate in one step; throws `InvalidAnswer`. */
export function parseAnswer<T>(text: string, schema: Schema): T {
  const value = extractJson(text);
  const problems = validate(value, schema);
  if (problems.length) throw new InvalidAnswer(problems);
  return value as T;
}
