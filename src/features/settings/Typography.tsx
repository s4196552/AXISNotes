import { useEffect, useState } from "react";
import { backend, isBackendError } from "../../ipc";
import { type AxisConfig, DEFAULT_CONFIG } from "../../app/config";
import { useAppStore } from "../../app/store";
import { LETTER_SPACING, LINE_HEIGHT, NOTE_FONT_SIZES } from "../../app/appearance";
import { VAULT_FONTS_FOLDER, vaultFonts } from "../../lib/fonts";
import { Field, FontSelect, ResetDefaults, type SectionProps } from "./parts";

/** The settings this tab owns (imported fonts stay in the vault). */
const TYPOGRAPHY_KEYS = [
  "noteFont",
  "uiFont",
  "noteFontSize",
  "letterSpacing",
  "lineHeight",
  "bionicReading",
] as const;

/** Settings → Appearance → Typography: fonts, text size, spacing and Bionic Reading. */
export function Typography({ config, set }: SectionProps) {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    void backend.listFonts().then(setFonts, () => {});
  }, []);
  const imported = useAppStore((s) =>
    vaultFonts(s.tree)
      .map((f) => f.family)
      .join("\n"),
  );
  const inVault = imported ? imported.split("\n") : [];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const a = config.appearance;
  const setA = (patch: Partial<AxisConfig["appearance"]>) =>
    set((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));

  const importFont = async () => {
    setMessage("");
    setBusy(true);
    try {
      const source = await backend.pickFont();
      if (!source) return;
      const entry = await backend.importFont(source);
      await useAppStore.getState().refreshTree();
      const family = entry.name.replace(/\.[^.]+$/, "");
      setMessage(`Added ${family}. Pick it as the note or interface font.`);
    } catch (e) {
      setMessage(isBackendError(e) || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const spacing = Math.round(a.letterSpacing * 100) / 100;
  return (
    <>
      <Field label="Note font">
        <FontSelect
          label="Note font"
          fonts={fonts}
          vaultFonts={inVault}
          value={a.noteFont}
          defaultLabel="Same as the interface"
          onChange={(noteFont) => setA({ noteFont })}
        />
      </Field>
      <Field label="Interface font">
        <FontSelect
          label="Interface font"
          fonts={fonts}
          vaultFonts={inVault}
          value={a.uiFont}
          defaultLabel="Default (system)"
          onChange={(uiFont) => setA({ uiFont })}
        />
      </Field>
      <Field
        label="Import a font"
        hint={`A TTF, OTF, WOFF or WOFF2 file is copied into ${VAULT_FONTS_FOLDER}, so this vault has it on any computer. It's listed under “In this vault”.`}
      >
        <button disabled={busy} onClick={() => void importFont()}>
          {busy ? "Adding…" : "Import font…"}
        </button>
        {message && (
          <p className="settings-hint" role="status">
            {message}
          </p>
        )}
      </Field>
      <Field label="Note text size" hint="The text of your notes; headings grow with it.">
        <span className="range-control">
          <input
            type="range"
            aria-label="Note text size"
            min={NOTE_FONT_SIZES.min}
            max={NOTE_FONT_SIZES.max}
            value={a.noteFontSize}
            onChange={(e) => setA({ noteFontSize: Number(e.target.value) })}
          />
          <span className="muted">{a.noteFontSize} px</span>
        </span>
      </Field>
      <Field label="Letter spacing" hint="Space between the letters of your notes.">
        <span className="range-control">
          <input
            type="range"
            aria-label="Letter spacing"
            min={LETTER_SPACING.min}
            max={LETTER_SPACING.max}
            step={LETTER_SPACING.step}
            value={a.letterSpacing}
            onChange={(e) => setA({ letterSpacing: Number(e.target.value) })}
          />
          <span className="muted">
            {spacing === 0 ? "Normal" : `${spacing > 0 ? "+" : ""}${spacing.toFixed(2)} em`}
          </span>
          {spacing !== 0 && <button onClick={() => setA({ letterSpacing: 0 })}>Reset</button>}
        </span>
      </Field>
      <Field label="Line height" hint="Space between the lines of your notes.">
        <span className="range-control">
          <input
            type="range"
            aria-label="Line height"
            min={LINE_HEIGHT.min}
            max={LINE_HEIGHT.max}
            step={LINE_HEIGHT.step}
            value={a.lineHeight}
            onChange={(e) => setA({ lineHeight: Number(e.target.value) })}
          />
          <span className="muted">{a.lineHeight.toFixed(2)}</span>
          {a.lineHeight !== 1.5 && <button onClick={() => setA({ lineHeight: 1.5 })}>Reset</button>}
        </span>
      </Field>
      <Field
        label="Bionic Reading"
        hint="The start of each word is bold, to guide your eyes along the text. Only how notes look while you read: the line you're editing stays plain and your Markdown files don't change."
      >
        <input
          type="checkbox"
          aria-label="Bionic Reading"
          checked={a.bionicReading}
          onChange={(e) => setA({ bionicReading: e.target.checked })}
        />
      </Field>
      <p
        className="settings-hint muted typography-sample"
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-note)",
          fontSize: "var(--note-font-size)",
          letterSpacing: "var(--note-letter-spacing, normal)",
          lineHeight: "var(--note-line-height)",
        }}
      >
        The quick brown fox jumps over the lazy dog. Notes stay plain Markdown, however they look.
      </p>
      <ResetDefaults
        what="typography"
        changed={TYPOGRAPHY_KEYS.some((k) => a[k] !== DEFAULT_CONFIG.appearance[k])}
        onReset={() =>
          setA(
            Object.fromEntries(
              TYPOGRAPHY_KEYS.map((k) => [k, DEFAULT_CONFIG.appearance[k]]),
            ) as Partial<AxisConfig["appearance"]>,
          )
        }
      />
    </>
  );
}
