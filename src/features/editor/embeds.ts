import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, EditorState, Facet, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { backend, isBackendError, type VaultChange } from "../../ipc";
import { useAppStore } from "../../app/store";
import { embedRange, ensureBlockId, listBlocks, listHeadings } from "../../lib/blocks";
import { noteName, parseWikilinkInner } from "../../lib/markdown";
import { isImagePath, parseImageEmbed, resolveAttachment } from "../../lib/attachments";
import { linkHost } from "./links";
import { livePreview } from "./livePreview";
import { axisTheme } from "./theme";

// Note/section/block embeds (`![[Note]]`, `![[Note#Heading]]`, `![[Note#^id]]`) rendered as
// editable mini-editors. Edits are written back into the source note, after checking the
// block on disk still matches what was loaded (otherwise the embed reloads instead).

/** Path of the note the editor is showing (link resolution is relative to it). */
export const notePath = Facet.define<string, string>({ combine: (v) => v[0] ?? "" });

export const EMBED_SAVE_DELAY_MS = 400;
const EMBED_LINE_RE = /^[ \t]*!\[\[([^[\]\n]+?)\]\][ \t]*$/;

/** Marks content replaced from disk (not an edit to save). */
const fromSource = Annotation.define<boolean>();

const describe = (e: unknown) => (isBackendError(e) ? e.message : String(e));

class EmbedController {
  private view: EditorView | null = null;
  private path: string | null = null;
  private loaded = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly body: HTMLElement,
    private readonly status: HTMLElement,
    private readonly inner: string,
    private readonly from: string,
    private readonly outer: EditorView,
  ) {
    void this.load();
    void backend
      .onVaultChanged((c) => this.onChanges(c))
      .then((u) => {
        if (this.destroyed) u();
        else this.unlisten = u;
      });
  }

  private setStatus(text: string) {
    this.status.textContent = text;
  }

  private async load() {
    const link = parseWikilinkInner(this.inner);
    try {
      this.path = await backend.resolveLink(link.target, this.from);
      if (this.destroyed) return;
      if (!this.path) {
        this.body.textContent = `“${link.target}” doesn't exist yet.`;
        this.body.classList.add("cm-embed-missing");
        return;
      }
      const file = await backend.readFile(this.path);
      if (this.destroyed) return;
      const range = embedRange(file.content, link);
      if (!range) {
        this.body.textContent = link.block
          ? `Block ^${link.block} not found.`
          : `Heading “${link.heading}” not found.`;
        this.body.classList.add("cm-embed-missing");
        return;
      }
      this.show(file.content.slice(range.from, range.to));
    } catch (e) {
      this.body.textContent = describe(e);
    }
  }

  private show(text: string) {
    this.loaded = text;
    if (this.view) {
      if (this.view.state.doc.toString() !== text) {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: text },
          annotations: fromSource.of(true),
        });
      }
      return;
    }
    this.body.textContent = "";
    // Editing a block of the note you're in would race with that note's own autosave.
    const readOnly = this.path === this.from;
    this.view = new EditorView({
      parent: this.body,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          livePreview,
          EditorView.lineWrapping,
          axisTheme,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": `Embedded ${this.inner}` }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(fromSource))) {
              this.schedule();
            }
            if (u.focusChanged && !u.view.hasFocus) void this.save();
          }),
        ],
      }),
    });
    this.setStatus(readOnly ? "read-only here" : "");
    this.outer.requestMeasure();
  }

  private schedule() {
    this.setStatus("unsaved");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), EMBED_SAVE_DELAY_MS);
  }

  get dirty() {
    return this.view !== null && this.view.state.doc.toString() !== this.loaded;
  }

  async save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.saving) await this.saving;
    if (!this.view || !this.path || !this.dirty) return;
    const next = this.view.state.doc.toString();
    const link = parseWikilinkInner(this.inner);
    const path = this.path;
    const op = (async () => {
      try {
        const file = await backend.readFile(path);
        const range = embedRange(file.content, link);
        if (!range || file.content.slice(range.from, range.to) !== this.loaded) {
          this.setStatus("changed in the source — reloaded");
          if (range) this.show(file.content.slice(range.from, range.to));
          return;
        }
        const text = file.content.slice(0, range.from) + next + file.content.slice(range.to);
        await backend.writeFile(path, text, file.modifiedMs);
        this.loaded = next;
        this.setStatus(this.dirty ? "unsaved" : "saved");
        useAppStore.getState().bumpIndex();
      } catch (e) {
        this.setStatus(`save failed: ${describe(e)}`);
      }
    })();
    this.saving = op;
    await op;
    this.saving = null;
  }

  private onChanges(changes: VaultChange[]) {
    if (!this.path || !changes.some((c) => c.paths.includes(this.path!))) return;
    if (this.dirty || this.saving || this.view?.hasFocus) return;
    void this.load();
  }

  destroy() {
    this.destroyed = true;
    if (this.dirty) void this.save();
    this.unlisten?.();
    this.view?.destroy();
    this.view = null;
  }
}

const controllers = new WeakMap<HTMLElement, EmbedController>();

/** For tests: the controller behind an embed element. */
export function embedControllerFor(el: HTMLElement): EmbedController | undefined {
  return controllers.get(el);
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly from: string,
  ) {
    super();
  }
  eq(other: EmbedWidget) {
    return other.inner === this.inner && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const link = parseWikilinkInner(this.inner);
    const root = document.createElement("div");
    root.className = "cm-embed";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", `Embed of ${this.inner}`);

    const header = document.createElement("div");
    header.className = "cm-embed-header";
    const open = document.createElement("button");
    open.className = "cm-embed-title";
    open.textContent =
      noteName(link.target) +
      (link.heading ? ` › ${link.heading}` : link.block ? ` › ^${link.block}` : "");
    open.title = "Open the source note";
    open.addEventListener("click", () => view.state.facet(linkHost).openLink(this.inner));
    const status = document.createElement("span");
    status.className = "cm-embed-status";
    const edit = document.createElement("button");
    edit.className = "cm-embed-edit";
    edit.textContent = "Edit link";
    edit.addEventListener("click", () => {
      const pos = view.posAtDOM(root);
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).from } });
      view.focus();
    });
    header.append(open, status, edit);

    const body = document.createElement("div");
    body.className = "cm-embed-body";
    body.textContent = "Loading…";
    root.append(header, body);
    controllers.set(root, new EmbedController(body, status, this.inner, this.from, view));
    return root;
  }
  destroy(dom: HTMLElement) {
    controllers.get(dom)?.destroy();
    controllers.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 90;
  }
}

/** `![[photo.png]]` (optionally `|width`) as an image. */
class ImageWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly from: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.inner === this.inner && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const { target, width } = parseImageEmbed(this.inner);
    const wrap = document.createElement("div");
    wrap.className = "cm-image-embed";
    const path = resolveAttachment(target, this.from, useAppStore.getState().tree);
    const url = path ? backend.fileUrl(path) : null;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = target;
      img.title = `${path} (click to edit the link)`;
      if (width) img.width = width;
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => {
        wrap.textContent = `Couldn't load ${target}`;
        wrap.classList.add("missing");
      });
      wrap.appendChild(img);
    } else {
      wrap.classList.add("missing");
      wrap.textContent = path ? `🖼 ${target}` : `🖼 ${target} (not found)`;
    }
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).to } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
  get estimatedHeight() {
    return 200;
  }
}

function embedDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  if (!doc.toString().includes("![[")) return Decoration.none;
  const from = state.facet(notePath);
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n);
  }
  const out: Range<Decoration>[] = [];
  let inFence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (/^[ \t]*(```|~~~)/.test(line.text)) inFence = !inFence;
    if (inFence || active.has(n)) continue;
    const m = EMBED_LINE_RE.exec(line.text);
    if (m)
      out.push(
        Decoration.replace({
          widget: isImagePath(parseImageEmbed(m[1]!).target)
            ? new ImageWidget(m[1]!, from)
            : new EmbedWidget(m[1]!, from),
          block: true,
        }).range(line.from, line.to),
      );
  }
  return Decoration.set(out);
}

const embedField = StateField.define<DecorationSet>({
  create: embedDecorations,
  update: (deco, tr) => (tr.docChanged || tr.selection ? embedDecorations(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

// ---- `[[Note#` heading and `[[Note#^` block completion ----

/** Completes headings after `[[Note#` and blocks after `[[Note#^` (adding ids as needed). */
export async function anchorCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const m = context.matchBefore(/\[\[([^[\]|#\n]+)#(\^?)([^[\]|#\n]*)$/);
  if (!m) return null;
  const [, target, caret] = /\[\[([^[\]|#\n]+)#(\^?)/.exec(m.text)!;
  const from = context.state.facet(notePath);
  const path = await backend.resolveLink(target!, from);
  if (!path) return null;
  const file = await backend.readFile(path);
  const start = m.from + 2 + target!.length + 1 + caret!.length;
  const close = context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? "" : "]]";
  if (!caret) {
    return {
      from: start,
      options: listHeadings(file.content).map<Completion>((h) => ({
        label: h,
        type: "text",
        apply: h + close,
      })),
      validFor: /^[^[\]|#\n]*$/,
    };
  }
  return {
    from: start,
    options: listBlocks(file.content).map<Completion>((b) => ({
      label: b.label.length > 70 ? b.label.slice(0, 67) + "…" : b.label,
      detail: b.id ? `^${b.id}` : "new id",
      type: "text",
      apply: async (view, _c, f, t) => {
        let id = b.id;
        if (!id) {
          // Add the id to the target note (fresh read + optimistic write).
          const fresh = await backend.readFile(path);
          const r = ensureBlockId(fresh.content, b.pos);
          if (!r) return;
          if (r.text !== fresh.content) await backend.writeFile(path, r.text, fresh.modifiedMs);
          id = r.id;
          useAppStore.getState().bumpIndex();
        }
        view.dispatch({
          changes: { from: f, to: t, insert: id + close },
          selection: { anchor: f + id.length + 2 },
        });
      },
    })),
    filter: true,
  };
}

export function embeds(path: string) {
  return [notePath.of(path), embedField];
}
