export type PropType = "text" | "number" | "checkbox" | "date" | "list";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function inferType(value: unknown): PropType {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (typeof value === "string" && DATE_RE.test(value)) return "date";
  return "text";
}

/** Convert a value when the user changes a property's type. */
export function convert(value: unknown, to: PropType): unknown {
  const asText = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  switch (to) {
    case "checkbox":
      return value === true || asText === "true";
    case "number": {
      const n = Number(asText);
      return Number.isFinite(n) ? n : 0;
    }
    case "list":
      return Array.isArray(value) ? value : asText ? asText.split(/\s*,\s*/).filter(Boolean) : [];
    case "date":
      return DATE_RE.test(asText) ? asText : new Date().toISOString().slice(0, 10);
    default:
      return asText;
  }
}
