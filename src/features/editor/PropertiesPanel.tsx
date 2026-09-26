import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Props } from "../../lib/markdown";
import { computeProps } from "../../lib/computed";
import { displayValue } from "../../lib/formula/sheet";
import { isErr, type Scalar } from "../../lib/formula/evaluate";
import { convert, inferType, type PropType } from "./propTypes";

// Typed editor for a note's frontmatter. The editor document stays the source of truth:
// every change is written back into the YAML block by the parent.

interface Props_ {
  props: Props;
  onChange(next: Props): void;
}

export function PropertiesPanel({ props, onChange }: Props_) {
  const keys = Object.keys(props);
  const [adding, setAdding] = useState(false);
  const computed = useMemo(() => computeProps(props), [props]);

  const setValue = (key: string, value: unknown) => onChange({ ...props, [key]: value });
  const remove = (key: string) => {
    const next = { ...props };
    delete next[key];
    onChange(next);
  };
  const rename = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from || name in props) return;
    // Rebuild to keep the key's position.
    onChange(Object.fromEntries(Object.entries(props).map(([k, v]) => [k === from ? name : k, v])));
  };

  if (keys.length === 0 && !adding) {
    return (
      <div className="props props-empty">
        <button className="props-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add property
        </button>
      </div>
    );
  }

  return (
    <section className="props" aria-label="Properties">
      {keys.map((key) => (
        <PropertyRow
          key={key}
          name={key}
          value={props[key]}
          result={computed[key]}
          onRename={(to) => rename(key, to)}
          onValue={(v) => setValue(key, v)}
          onRemove={() => remove(key)}
        />
      ))}
      {adding ? (
        <NewProperty
          existing={keys}
          onAdd={(name) => {
            setAdding(false);
            if (name) setValue(name, "");
          }}
        />
      ) : (
        <button className="props-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add property
        </button>
      )}
    </section>
  );
}

function PropertyRow(p: {
  name: string;
  value: unknown;
  /** Result of a formula value. */
  result?: Scalar;
  onRename(to: string): void;
  onValue(v: unknown): void;
  onRemove(): void;
}) {
  const type = inferType(p.value);
  return (
    <div className="props-row">
      <input
        className="props-key"
        aria-label="Property name"
        defaultValue={p.name}
        onBlur={(e) => p.onRename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <select
        className="props-type"
        aria-label={`Type of ${p.name}`}
        value={type}
        disabled={type === "object"}
        onChange={(e) => p.onValue(convert(p.value, e.target.value as PropType))}
      >
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="checkbox">Checkbox</option>
        <option value="date">Date</option>
        <option value="list">List</option>
        <option value="formula">Formula</option>
        {type === "object" && <option value="object">Structured</option>}
      </select>
      <ValueEditor
        key={`${type}:${JSON.stringify(p.value)}`}
        name={p.name}
        type={type}
        value={p.value}
        result={p.result}
        onValue={p.onValue}
      />
      <button className="props-remove" aria-label={`Remove ${p.name}`} onClick={p.onRemove}>
        <X size={14} />
      </button>
    </div>
  );
}

function ValueEditor(p: {
  name: string;
  type: PropType;
  value: unknown;
  result?: Scalar;
  onValue(v: unknown): void;
}) {
  const label = `Value of ${p.name}`;
  switch (p.type) {
    case "formula": {
      const r = p.result;
      const error = r !== undefined && isErr(r);
      return (
        <span className="props-formula">
          <input
            className="props-value props-formula-input"
            aria-label={label}
            defaultValue={String(p.value)}
            onBlur={(e) => p.onValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <output
            className={`props-result${error ? " error" : ""}`}
            aria-label={`Result of ${p.name}`}
            title={error && r.detail ? r.detail : undefined}
          >
            = {displayValue(r)}
          </output>
        </span>
      );
    }
    case "object": {
      const n = Array.isArray(p.value) ? p.value.length : Object.keys(p.value as object).length;
      return (
        <span
          className="props-value props-object"
          aria-label={label}
          title={JSON.stringify(p.value, null, 2)}
        >
          {n}{" "}
          {Array.isArray(p.value) ? (n === 1 ? "entry" : "entries") : n === 1 ? "field" : "fields"}
        </span>
      );
    }
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={p.value === true}
          onChange={(e) => p.onValue(e.target.checked)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className="props-value"
          aria-label={label}
          defaultValue={String(p.value)}
          onBlur={(e) => p.onValue(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <input
          type="date"
          className="props-value"
          aria-label={label}
          value={String(p.value)}
          onChange={(e) => p.onValue(e.target.value)}
        />
      );
    case "list":
      return (
        <input
          className="props-value"
          aria-label={label}
          placeholder="a, b, c"
          defaultValue={(p.value as unknown[]).join(", ")}
          onBlur={(e) => p.onValue(e.target.value.split(/\s*,\s*/).filter(Boolean))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      );
    default:
      return (
        <input
          className="props-value"
          aria-label={label}
          defaultValue={p.value == null ? "" : String(p.value)}
          onBlur={(e) => p.onValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      );
  }
}

function NewProperty({
  existing,
  onAdd,
}: {
  existing: string[];
  onAdd(name: string | null): void;
}) {
  const [name, setName] = useState("");
  const taken = existing.includes(name.trim());
  return (
    <form
      className="props-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!taken) onAdd(name.trim() || null);
      }}
    >
      <input
        className="props-key"
        aria-label="New property name"
        placeholder="name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onAdd(null)}
      />
      <button type="submit" disabled={!name.trim() || taken}>
        Add
      </button>
    </form>
  );
}
