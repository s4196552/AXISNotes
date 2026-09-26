import { useCallback, useEffect, useRef, useState } from "react";
import { ListTree } from "lucide-react";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { backend, isBackendError, type VaultChange } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { type Props, splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { useUi } from "../commands/ui";
import { PAGE_STYLE_PROP, PAGE_STYLES } from "../templates/templates";
import { setActiveEditor } from "./activeEditor";
import { links, refreshLinks, wikilinkCompletions } from "./links";
import { findTarget, isKnownTarget, minimalChange } from "./targets";
import { livePreview } from "./livePreview";
import { PropertiesPanel } from "./PropertiesPanel";
import { outlinerKeys, outlineView } from "./outlinerView";
import { useEditorPrefs } from "./prefs";
import {
  emojiCompletions,
  type QuickCommandConfig,
  quickCommandConfig,
  slashCompletions,
} from "./quickCommands";

function quickConfig(): QuickCommandConfig {
  return {
    ...useConfig.getState().config.quickCommands,
    insertTemplate: () => useUi.getState().open({ kind: "templates", mode: "insert" }),
  };
}
import { axisTheme } from "./theme";
import "./editor.css";

export interface EditorProps {
  /** Vault-relative path of the note to edit. The parent remounts on path change. */
  path: string;
}

export const AUTOSAVE_DELAY_MS = 500;

type SaveStatus = "loading" | "saved" | "saving" | "dirty" | "error";
type Banner = null | "conflict" | "removed";

/** Marks document replacements that come from disk, so they don't count as edits. */
const fromDisk = Annotation.define<boolean>();

const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: "Loading…",
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Save failed",
};

function pageStyle(props: Props): string {
  const s = props[PAGE_STYLE_PROP];
  return typeof s === "string" && (PAGE_STYLES as readonly string[]).includes(s) ? s : "plain";
}

function titleOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function Editor({ path }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const mtime = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  /** Autosave is paused while a conflict/removed banner is showing. */
  const paused = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<SaveStatus>("loading");
  const [banner, setBannerState] = useState<Banner>(null);
  const [ready, setReady] = useState(false);
  const [props, setProps] = useState<Props>({});
  const quickCompartment = useRef(new Compartment());
  const outlineCompartment = useRef(new Compartment());
  const outlineOn = useEditorPrefs((s) => s.outlineView);
  const toggleOutline = useEditorPrefs((s) => s.toggleOutlineView);
  const propsJson = useRef("{}");

  const syncProps = useCallback((state: EditorState) => {
    const head = state.sliceDoc(0, Math.min(state.doc.length, 20_000));
    const next = splitFrontmatter(head).props;
    const json = JSON.stringify(next);
    if (json !== propsJson.current) {
      propsJson.current = json;
      setProps(next);
    }
  }, []);

  const changeProps = useCallback((next: Props) => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    const change = minimalChange(text, withFrontmatter(text, next));
    if (change.from !== change.to || change.insert) v.dispatch({ changes: change });
  }, []);

  const setBanner = useCallback((b: Banner) => {
    paused.current = b !== null;
    setBannerState(b);
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /**
   * Write the current document. `force` skips the on-disk change check
   * (used by "Keep my version" / "Save here anyway").
   */
  const save = useCallback(
    async (force = false): Promise<void> => {
      clearTimer();
      const v = view.current;
      if (!v || (!force && (!dirty.current || paused.current))) return;
      if (saving.current) await saving.current; // one write at a time
      const content = v.state.doc.toString();
      setStatus("saving");
      const op = (async () => {
        try {
          const res = await backend.writeFile(path, content, force ? undefined : mtime.current);
          mtime.current = res.modifiedMs;
          useAppStore.getState().bumpIndex(); // tags/links may have changed
          if (v.state.doc.toString() === content) {
            dirty.current = false;
            setStatus("saved");
          } else {
            setStatus("dirty"); // edited while saving; the pending timer will save again
          }
        } catch (e) {
          if (isBackendError(e) && e.code === "Conflict") {
            setBanner("conflict");
            setStatus("dirty");
          } else {
            setStatus("error");
            useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
          }
        }
      })();
      saving.current = op;
      await op;
      saving.current = null;
    },
    [path, setBanner],
  );

  const scheduleSave = useCallback(() => {
    clearTimer();
    if (!paused.current) timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [save]);

  /** Replace the document with what is on disk, keeping the cursor where possible. */
  const reloadFromDisk = useCallback(async () => {
    const v = view.current;
    if (!v) return;
    const file = await backend.readFile(path);
    mtime.current = file.modifiedMs;
    dirty.current = false;
    if (file.content !== v.state.doc.toString()) {
      const head = Math.min(v.state.selection.main.head, file.content.length);
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: file.content },
        selection: { anchor: head },
        annotations: fromDisk.of(true),
      });
    }
    setStatus("saved");
  }, [path]);

  // Create the editor once the note has loaded.
  useEffect(() => {
    let cancelled = false;
    let created: EditorView | null = null;

    backend
      .readFile(path)
      .then((file) => {
        if (cancelled || !host.current) return;
        mtime.current = file.modifiedMs;
        const store = useAppStore.getState;
        created = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: file.content,
            // Start below the frontmatter so it shows as the properties chip.
            selection: EditorSelection.cursor(splitFrontmatter(file.content).length),
            extensions: [
              history(),
              drawSelection(),
              search({ top: true }),
              highlightSelectionMatches(),
              autocompletion({
                override: [wikilinkCompletions, slashCompletions, emojiCompletions],
              }),
              quickCompartment.current.of(quickCommandConfig.of(quickConfig())),
              outlinerKeys,
              outlineCompartment.current.of(
                useEditorPrefs.getState().outlineView ? outlineView : [],
              ),
              EditorView.lineWrapping,
              yamlFrontmatter({
                content: markdown({ base: markdownLanguage, codeLanguages: languages }),
              }),
              livePreview,
              links({
                openLink: (inner) => void store().openLink(inner, path),
                openTag: (tag) => store().search(`tag:${tag}`),
                isKnown: (target) => isKnownTarget(store().notes, target),
                notes: () => store().notes,
              }),
              axisTheme,
              keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
              EditorView.contentAttributes.of({ "aria-label": `Note ${titleOf(path)}` }),
              EditorView.updateListener.of((u) => {
                if (u.docChanged) syncProps(u.state);
                if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) {
                  dirty.current = true;
                  setStatus("dirty");
                  scheduleSave();
                }
                if (u.focusChanged && !u.view.hasFocus) void save();
              }),
            ],
          }),
        });
        view.current = created;
        setActiveEditor(created, path);
        syncProps(created.state);
        setStatus("saved");
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      // Flush unsaved edits on unmount (fire-and-forget; the view is going away).
      clearTimer();
      if (created && dirty.current && !paused.current) {
        void backend
          .writeFile(path, created.state.doc.toString(), mtime.current)
          .catch((e: unknown) =>
            useAppStore.getState().setError(isBackendError(e) ? e.message : String(e)),
          );
      }
      created?.destroy();
      view.current = null;
      setActiveEditor(null);
    };
  }, [path, save, scheduleSave, syncProps]);

  // Jump to a heading/block/line requested by the link that opened this note.
  const pendingTarget = useAppStore((s) => s.pendingTarget);
  useEffect(() => {
    const v = view.current;
    if (!ready || !v || pendingTarget?.path !== path) return;
    const pos = findTarget(v.state, pendingTarget);
    useAppStore.getState().clearPendingTarget();
    if (pos !== null) {
      v.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }),
      });
      v.focus();
    }
  }, [ready, pendingTarget, path]);

  useEffect(() => {
    view.current?.dispatch({
      effects: outlineCompartment.current.reconfigure(outlineOn ? outlineView : []),
    });
  }, [outlineOn]);

  // Follow changes to the quick-command settings.
  const quickSettings = useConfig((s) => s.config.quickCommands);
  useEffect(() => {
    view.current?.dispatch({
      effects: quickCompartment.current.reconfigure(quickCommandConfig.of(quickConfig())),
    });
  }, [quickSettings]);

  // Re-style links when notes appear or disappear.
  const notes = useAppStore((s) => s.notes);
  useEffect(() => {
    view.current?.dispatch({ effects: refreshLinks.of(null) });
  }, [notes]);

  // React to edits made outside the app.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const onChanges = (changes: VaultChange[]) => {
      for (const c of changes) {
        if (!c.paths.includes(path)) continue;
        // For "renamed" ([from, to]) only moving *away* from this path removes the note.
        const movedAway = c.kind === "renamed" && c.paths[0] === path;
        if (c.kind === "removed" || movedAway) {
          // A rename done inside the app remounts the editor on the new path;
          // this only fires for moves/deletes made elsewhere.
          clearTimer();
          setBanner("removed");
        } else if (dirty.current) {
          clearTimer();
          setBanner("conflict");
        } else {
          void reloadFromDisk().catch(() => setBanner("removed"));
        }
      }
    };
    backend.onVaultChanged(onChanges).then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path, reloadFromDisk, setBanner]);

  return (
    <div className="editor">
      <header className="editor-header">
        <h1 className="editor-title">{titleOf(path)}</h1>
        <button
          className={`editor-tool${outlineOn ? " active" : ""}`}
          aria-label="Outline view"
          aria-pressed={outlineOn}
          title="Outline view: fold gutter and drag handles (Alt+↑/↓ moves, Tab indents)"
          onClick={toggleOutline}
        >
          <ListTree size={15} />
        </button>
        <span className={`editor-status status-${status}`} role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      </header>

      {banner === "conflict" && (
        <div className="editor-banner" role="alert">
          <span>This note changed on disk.</span>
          <button
            onClick={() => {
              setBanner(null);
              void reloadFromDisk();
            }}
          >
            Reload from disk
          </button>
          <button
            className="primary"
            onClick={() => {
              setBanner(null);
              void save(true);
            }}
          >
            Keep my version
          </button>
        </div>
      )}
      {banner === "removed" && (
        <div className="editor-banner" role="alert">
          <span>This note was moved or deleted.</span>
          <button
            className="primary"
            onClick={() => {
              setBanner(null);
              void save(true);
            }}
          >
            Save here anyway
          </button>
        </div>
      )}

      {ready && <PropertiesPanel props={props} onChange={changeProps} />}

      <div ref={host} className={`editor-host page-${pageStyle(props)}`} />
    </div>
  );
}
