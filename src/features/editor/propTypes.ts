import { isFormula } from "../../lib/computed";

/** `object`: structured YAML (maps, lists of maps) shown read-only, e.g. `time_log`. */
export type PropType = "text" | "number" | "checkbox" | "date" | "list" | "formula" | "object";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function inferType(value: unknown): PropType {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value))
    return value.some((v) => typeof v === "object" && v !== null) ? "object" : "list";
  if (typeof value === "object" && value !== null) return "object";
  if (isFormula(value)) return "formula";
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
    case "formula":
      return isFormula(asText) ? asText : `=${asText || 0}`;
    default:
      return asText;
  }
}
