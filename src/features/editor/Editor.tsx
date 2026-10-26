import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListTree, Sparkles, WandSparkles } from "lucide-react";
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
import {
  currentVault,
  registerDocument,
  SAVE_ATTEMPTS,
  trackClosingWrite,
  type UnsavedDocument,
} from "../files/unsavedWork";
import { setActiveEditor } from "./activeEditor";
import { links, refreshLinks, wikilinkCompletions } from "./links";
import { anchorCompletions, embeds } from "./embeds";
import { mediaInput } from "./media";
import { findTarget, isKnownTarget, minimalChange } from "./targets";
import { livePreview } from "./livePreview";
import { tables } from "./tables";
import { obsidianSyntax } from "./obsidianSyntax";
import { PropertiesPanel } from "./PropertiesPanel";
import { PageHeader } from "./PageHeader";
import { NoteTitle } from "./NoteTitle";
import { DAILY_TITLE_FORMAT, startBelowTitle, titleHeading, titleOf } from "./titleHeading";
import { takeEditorFocus } from "./focusRequest";
import { countWords, wordCount } from "./wordCount";
import { useStatusSlot } from "./statusSlot";
import { outlinerKeys, outlineView } from "./outlinerView";
import { listAutoformat } from "./listAutoformat";
import { useEditorPrefs } from "./prefs";
import { TimerButton } from "../time/TimerControls";
import { dailyDateOf, followLink, openAskAi, openFixText } from "../commands/actions";
import { formatDate } from "../../lib/dates";
import { allCommands } from "../commands/registry";
import { configuredSpellcheck, recheck } from "../spellcheck";
import { mermaidBlocks } from "../diagrams/mermaidBlocks";
import "../diagrams/diagrams.css";
import {
  commandMenuAnchor,
  commandMenuRender,
  emojiCompletions,
  type QuickCommandConfig,
  quickCommandConfig,
  slashCompletions,
} from "./quickCommands";
import { toggles } from "./toggles";
import {
  blockCompletions,
  mentionCompletions,
  propertyCompletions,
  templateCompletions,
} from "./triggers";
import { math } from "./math";

function quickConfig(): QuickCommandConfig {
  const config = useConfig.getState().config;
  return {
    ...config.quickCommands,
    dailyFormat: config.dailyNotes.format,
    dailyFolder: config.dailyNotes.folder,
    templatesFolder: config.templatesFolder,
    insertTemplate: () => useUi.getState().open({ kind: "templates", mode: "insert" }),
    runCommand: (id) =>
      allCommands()
        .find((c) => c.id === id)
        ?.run(),
  };
}
import { codeLanguageCompletions } from "./code";
import { axisTheme } from "./theme";
import "./editor.css";

export interface EditorProps {
  /** Vault-relative path of the note to edit. The parent remounts on path change. */
  path: string;
}

export const AUTOSAVE_DELAY_MS = 500;

/**
 * Where each note's cursor and scroll were when its editor closed, so switching back to
 * a tab (or reopening the note) returns to the same place. Kept for this session only.
 */
const viewStates = new Map<string, { anchor: number; head: number; scrollTop: number }>();
const VIEW_STATE_LIMIT = 200;

function rememberViewState(path: string, view: EditorView) {
  const { anchor, head } = view.state.selection.main;
  viewStates.delete(path); // re-insert as the newest
  viewStates.set(path, { anchor, head, scrollTop: view.scrollDOM.scrollTop });
  if (viewStates.size > VIEW_STATE_LIMIT) viewStates.delete(viewStates.keys().next().value!);
}

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

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function pageStyle(props: Props): string {
  const s = props[PAGE_STYLE_PROP];
  return typeof s === "string" && (PAGE_STYLES as readonly string[]).includes(s) ? s : "plain";
}

export function Editor({ path }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const mtime = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  /** Autosave is paused while a conflict/removed banner is showing. */
  const paused = useRef(false);
  const bannerRef = useRef<Banner>(null);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<SaveStatus>("loading");
  const [banner, setBannerState] = useState<Banner>(null);
  const [ready, setReady] = useState(false);
  const [props, setProps] = useState<Props>({});
  const quickCompartment = useRef(new Compartment());
  const outlineCompartment = useRef(new Compartment());
  const spellCompartment = useRef(new Compartment());
  const outlineOn = useEditorPrefs((s) => s.outlineView);
  const toggleOutline = useEditorPrefs((s) => s.toggleOutlineView);
  const propsJson = useRef("{}");
  const titleRef = useRef<HTMLInputElement>(null);

  // Word count for the status bar (of the selection too, when there is one), counted a
  // moment after typing stops so long notes don't recount on every key.
  const [words, setWords] = useState<{ total: number; selected: number } | null>(null);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countNow = useCallback((state: EditorState) => {
    const sel = state.selection.ranges
      .filter((r) => !r.empty)
      .reduce((n, r) => n + countWords(state.sliceDoc(r.from, r.to)), 0);
    setWords({ total: wordCount(state.doc.toString()), selected: sel });
  }, []);
  const scheduleCount = useCallback(
    (state: EditorState) => {
      if (countTimer.current) clearTimeout(countTimer.current);
      countTimer.current = setTimeout(() => countNow(state), 200);
    },
    [countNow],
  );
  useEffect(() => () => void (countTimer.current && clearTimeout(countTimer.current)), []);

  // The save state and word count sit in the app's status bar when there is one (the
  // editor alone, as in tests, keeps them in its header).
  const statusSlot = useStatusSlot((s) => s.el);

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
    if (change.from === change.to && !change.insert) return;
    // A cursor below the frontmatter stays below it, so the YAML stays folded behind its
    // chip (a cursor at the very top would otherwise end up inside a new block).
    const below = v.state.selection.main.from >= splitFrontmatter(text).length;
    const changes = v.state.changes(change);
    v.dispatch(below ? { changes, selection: v.state.selection.map(changes, 1) } : { changes });
  }, []);

  const setBanner = useCallback((b: Banner) => {
    paused.current = b !== null;
    bannerRef.current = b;
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
      // One write at a time. Several saves can be waiting (autosave, blur, install's
      // flush); each waits for whichever write is current, then checks it's still needed.
      while (saving.current) await saving.current;
      if (!force && (!dirty.current || paused.current)) return;
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

  /** Save now, waiting for the write; reports changes that still aren't on disk. */
  const flush = useCallback(async (): Promise<UnsavedDocument | null> => {
    for (let i = 0; i < SAVE_ATTEMPTS && dirty.current && !paused.current; i++) await save();
    if (saving.current) await saving.current;
    return dirty.current ? { path, reason: bannerRef.current ?? "failed" } : null;
  }, [path, save]);

  useEffect(() => registerDocument(() => path, flush), [path, flush]);

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
    const vault = currentVault();

    backend
      .readFile(path)
      .then((file) => {
        if (cancelled || !host.current) return;
        mtime.current = file.modifiedMs;
        const store = useAppStore.getState;
        // Back where it was, unless a link asked for a heading/block/line.
        const pending = store().pendingTarget?.path === path;
        const saved = pending ? undefined : viewStates.get(path);
        const len = file.content.length;
        const daily = dailyDateOf(path);
        const initial = EditorState.create({
          doc: file.content,
          // Else start below the frontmatter so it shows as the properties chip.
          selection: saved
            ? EditorSelection.single(Math.min(saved.anchor, len), Math.min(saved.head, len))
            : EditorSelection.cursor(splitFrontmatter(file.content).length),
          extensions: [
            titleHeading(
              daily ? [formatDate(daily, DAILY_TITLE_FORMAT), titleOf(path)] : [titleOf(path)],
            ),
            history(),
            drawSelection(),
            search({ top: true }),
            highlightSelectionMatches(),
            autocompletion({
              override: [
                codeLanguageCompletions,
                anchorCompletions,
                wikilinkCompletions,
                slashCompletions,
                emojiCompletions,
                mentionCompletions,
                blockCompletions,
                propertyCompletions,
                templateCompletions,
              ],
              addToOptions: commandMenuRender,
            }),
            commandMenuAnchor,
            embeds(path),
            mediaInput,
            quickCompartment.current.of(quickCommandConfig.of(quickConfig())),
            outlinerKeys,
            listAutoformat,
            outlineCompartment.current.of(useEditorPrefs.getState().outlineView ? outlineView : []),
            EditorView.lineWrapping,
            yamlFrontmatter({
              content: markdown({ base: markdownLanguage, codeLanguages: languages }),
            }),
            livePreview,
            tables,
            obsidianSyntax,
            toggles,
            mermaidBlocks,
            math,
            spellCompartment.current.of(configuredSpellcheck()),
            links({
              openLink: (inner, newTab) => void followLink(inner, path, { newTab }),
              openTag: (tag) => store().search(`tag:${tag}`),
              isKnown: (target) => isKnownTarget(store().notes, target),
              notes: () => store().notes,
            }),
            axisTheme,
            // Ctrl+/ is the command menu (a remappable app command), not "toggle comment".
            keymap.of([
              ...defaultKeymap.filter((k) => k.key !== "Mod-/"),
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            EditorView.contentAttributes.of({ "aria-label": `Note ${titleOf(path)}` }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) syncProps(u.state);
              if (u.docChanged || u.selectionSet) scheduleCount(u.state);
              if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) {
                dirty.current = true;
                setStatus("dirty");
                scheduleSave();
              }
              if (u.focusChanged && !u.view.hasFocus) void save();
            }),
          ],
        });
        // A note opened fresh starts below a hidden title heading, so it stays hidden.
        const head = initial.selection.main.head;
        const start = saved ? head : startBelowTitle(initial, head);
        created = new EditorView({
          parent: host.current,
          state: start === head ? initial : initial.update({ selection: { anchor: start } }).state,
        });
        view.current = created;
        setActiveEditor(created, path);
        syncProps(created.state);
        countNow(created.state);
        setStatus("saved");
        setReady(true);
        const want = takeEditorFocus(path);
        if (want === "title" && titleRef.current) {
          titleRef.current.focus();
          titleRef.current.select();
        } else if (want) created.focus();
        if (saved) {
          const v = created;
          v.requestMeasure({
            read: () => {},
            write: () => (v.scrollDOM.scrollTop = saved.scrollTop),
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      // Flush unsaved edits on unmount (the view is going away). If they can't be written,
      // they are kept in an "(unsaved …)" file instead.
      clearTimer();
      if (created && dirty.current) {
        const content = created.state.doc.toString();
        trackClosingWrite(path, content, vault, async () => {
          while (saving.current) await saving.current; // it may have saved this already
          if (!dirty.current) return;
          // With the "changed on disk" or "moved or deleted" banner up, writing would
          // overwrite the other version or bring the file back: keep these changes in a
          // recovery file instead (T-074).
          if (paused.current) {
            throw new Error(
              bannerRef.current === "removed" ? "it was moved or deleted" : "it changed on disk",
            );
          }
          await backend.writeFile(path, content, mtime.current, vault ?? undefined);
        });
      }
      if (created) rememberViewState(path, created);
      created?.destroy();
      view.current = null;
      setActiveEditor(null);
    };
  }, [path, save, scheduleSave, syncProps, scheduleCount, countNow]);

  // Once the note is scrolled, the page header shrinks so the cover doesn't take space.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = view.current?.scrollDOM;
    if (!ready || !el) return;
    const onScroll = () => setScrolled(el.scrollTop > 24);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ready]);

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
  const dailyNotes = useConfig((s) => s.config.dailyNotes);
  const templatesFolder = useConfig((s) => s.config.templatesFolder);
  useEffect(() => {
    view.current?.dispatch({
      effects: quickCompartment.current.reconfigure(quickCommandConfig.of(quickConfig())),
    });
  }, [quickSettings, dailyNotes, templatesFolder]);

  // Follow the spellcheck settings (on/off, personal dictionary).
  const spellOn = useConfig((s) => s.config.spellcheck.enabled);
  const spellWords = useConfig((s) => s.config.spellcheck.words);
  useEffect(() => {
    view.current?.dispatch({
      effects: spellCompartment.current.reconfigure(configuredSpellcheck()),
    });
  }, [spellOn]);
  useEffect(() => {
    view.current?.dispatch({ effects: recheck.of(null) });
  }, [spellWords]);

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

  const docStatus = (
    <span className="editor-doc-status">
      {words && (
        <span className="editor-words">
          {words.selected
            ? `${words.selected.toLocaleString()} of ${plural(words.total, "word")}`
            : plural(words.total, "word")}
        </span>
      )}
      <span className={`editor-status status-${status}`} role="status" aria-live="polite">
        {STATUS_TEXT[status]}
      </span>
    </span>
  );

  return (
    <div className="editor">
      {/* Shown while loading too, so the title doesn't jump when the note arrives. */}
      <PageHeader path={path} props={props} onChange={changeProps} compact={scrolled} />
      <header className="editor-header">
        <NoteTitle
          ref={titleRef}
          path={path}
          beforeRename={async () => (await flush()) === null}
          focusBody={() => view.current?.focus()}
        />
        <div className="editor-tools">
          <button
            className={`editor-tool${outlineOn ? " active" : ""}`}
            aria-label="Outline view"
            aria-pressed={outlineOn}
            title="Outline view: fold gutter and drag handles (Alt+↑/↓ moves, Tab indents)"
            onClick={toggleOutline}
          >
            <ListTree size={15} />
          </button>
          <button
            className="editor-tool"
            aria-label="Ask AI"
            title="Ask AI about this note (Ctrl+J)"
            onClick={openAskAi}
          >
            <Sparkles size={15} />
          </button>
          <button
            className="editor-tool"
            aria-label="Fix writing"
            title="Fix grammar and clarity with AI (Ctrl+Shift+G)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openFixText}
          >
            <WandSparkles size={15} />
          </button>
          <TimerButton path={path} />
        </div>
        {!statusSlot && docStatus}
      </header>
      {statusSlot && createPortal(docStatus, statusSlot)}

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
