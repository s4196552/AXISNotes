import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, EditorState, Facet, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { backend, isBackendError, type VaultChange } from "../../ipc";
import { useAppStore } from "../../app/store";
import { embedRange, ensureBlockId, listBlocks, listHeadings } from "../../lib/blocks";
import { noteName, parseWikilinkInner } from "../../lib/markdown";
import {
  isWebUrl,
  type MediaKind,
  mediaKind,
  parseImageEmbed,
  parseMarkdownEmbed,
  resolveMedia,
  videoPlayerUrl,
} from "../../lib/attachments";
import {
  currentVault,
  registerDocument,
  SAVE_ATTEMPTS,
  trackClosingWrite,
} from "../files/unsavedWork";
import { linkHost } from "./links";
import { livePreview } from "./livePreview";
import { axisTheme } from "./theme";
import { tables } from "./tables";
import { imageTools } from "./imageEditor";
import { readImageLayout } from "../../lib/imageLayout";

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

type WriteBack = { ok: true } | { ok: false; current: string | null };

/** Write `next` over the embedded block in `path` if the block on disk is still `loaded`.
 *  Otherwise nothing is written and `current` is the block on disk (null if it's gone). */
async function writeBlock(
  path: string,
  inner: string,
  loaded: string,
  next: string,
  /** Write only while this vault (the embed's own) is still open (T-073). */
  vaultRoot?: string,
) {
  const link = parseWikilinkInner(inner);
  const file = await backend.readFile(path);
  const range = embedRange(file.content, link);
  if (!range || file.content.slice(range.from, range.to) !== loaded) {
    return { ok: false, current: range && file.content.slice(range.from, range.to) } as WriteBack;
  }
  const text = file.content.slice(0, range.from) + next + file.content.slice(range.to);
  await backend.writeFile(path, text, file.modifiedMs, vaultRoot);
  useAppStore.getState().bumpIndex();
  return { ok: true } as WriteBack;
}

/** Write `next` over the embedded block as it is on disk now ("Keep mine"). Returns false
 *  if the block is no longer in the source. */
async function overwriteBlock(path: string, inner: string, next: string, vaultRoot?: string) {
  const file = await backend.readFile(path);
  const range = embedRange(file.content, parseWikilinkInner(inner));
  if (!range) return false;
  const text = file.content.slice(0, range.from) + next + file.content.slice(range.to);
  await backend.writeFile(path, text, file.modifiedMs, vaultRoot);
  useAppStore.getState().bumpIndex();
  return true;
}

class EmbedController {
  private view: EditorView | null = null;
  private path: string | null = null;
  private loaded = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private destroyed = false;
  /** The vault this embed was loaded from; its writes only land there. */
  private readonly vault = currentVault();
  private readonly vaultRoot = this.vault ?? undefined;
  /** Which conflict buttons are showing (true: the block exists), if any. */
  private shownConflict: boolean | null = null;
  /** Why the last save didn't write the edit, if it didn't. */
  private problem: "conflict" | "failed" | null = null;
  /** Lets installing an update or closing the window save this embed first (T-073). */
  private readonly unregister = registerDocument(
    () => this.path ?? this.from,
    async () => {
      this.problem = null;
      for (let i = 0; i < SAVE_ATTEMPTS && this.dirty && this.problem !== "conflict"; i++) {
        await this.save();
      }
      if (!this.dirty || !this.path) return null;
      return { path: this.path, reason: this.problem ?? "failed" };
    },
  );

  constructor(
    private readonly body: HTMLElement,
    private readonly status: HTMLElement,
    /** Where "Reload from source" / "Keep mine" appear when the source block changed. */
    private readonly actions: HTMLElement,
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
          tables,
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

  /** If the source block changed meanwhile, the edit is kept and the user chooses
   *  (T-074): reload the block, or keep this version. Nothing is overwritten unasked. */
  async save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.saving) await this.saving; // one write at a time
    if (!this.view || !this.path || !this.dirty) return;
    const next = this.view.state.doc.toString();
    const path = this.path;
    const op = (async () => {
      try {
        const r = await writeBlock(path, this.inner, this.loaded, next, this.vaultRoot);
        if (!r.ok) {
          this.problem = "conflict";
          this.showConflict(r.current !== null);
          return;
        }
        this.problem = null;
        this.clearConflict();
        this.loaded = next;
        this.setStatus(this.dirty ? "unsaved" : "saved");
      } catch (e) {
        this.problem = "failed";
        this.setStatus(`save failed: ${describe(e)}`);
      }
    })();
    this.saving = op;
    await op;
    this.saving = null;
  }

  private showConflict(blockExists: boolean) {
    this.setStatus(
      blockExists ? "changed in the source — not saved" : "no longer in the source — not saved",
    );
    // Keep the same buttons while the choice is the same: a save started by pressing one
    // (the embed's blur) must not swap it out from under the click, or drop focus.
    if (this.shownConflict === blockExists) return;
    this.shownConflict = blockExists;
    const button = (label: string, run: () => Promise<void>) => {
      const b = document.createElement("button");
      b.className = "cm-embed-edit cm-embed-action";
      b.textContent = label;
      // Pressing it leaves focus in the embed, so no blur save starts first.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => void run());
      return b;
    };
    this.actions.replaceChildren(
      ...(blockExists
        ? [
            button("Reload from source", () => this.reloadFromSource()),
            button("Keep mine", () => this.keepMine()),
          ]
        : [button("Discard my edit", () => this.reloadFromSource())]),
    );
  }

  private clearConflict() {
    this.shownConflict = null;
    this.actions.replaceChildren();
  }

  /** Drop the edit and show the block as it is in the source now. */
  async reloadFromSource(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.saving) await this.saving;
    this.problem = null;
    this.clearConflict();
    this.view?.destroy();
    this.view = null;
    this.loaded = "";
    this.body.textContent = "Loading…";
    await this.load();
  }

  /** Write this version over the block as it is in the source now. */
  async keepMine(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.saving) await this.saving;
    if (!this.view || !this.path) return;
    const next = this.view.state.doc.toString();
    const path = this.path;
    const op = (async () => {
      try {
        if (!(await overwriteBlock(path, this.inner, next, this.vaultRoot))) {
          return this.showConflict(false);
        }
        this.problem = null;
        this.loaded = next;
        this.clearConflict();
        this.setStatus(this.dirty ? "unsaved" : "saved");
      } catch (e) {
        this.problem = "failed";
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
    this.unregister();
    if (this.dirty && this.path) {
      const path = this.path;
      const next = this.view!.state.doc.toString();
      // Rejects unless the edit reached the disk; then the block is kept in an
      // "(unsaved …)" file next to the source note instead.
      trackClosingWrite(path, next, this.vault, async () => {
        while (this.saving) await this.saving;
        if (next === this.loaded) return;
        const r = await writeBlock(path, this.inner, this.loaded, next, this.vaultRoot);
        if (!r.ok) throw new Error(`the embedded block in ${path} changed`);
        this.loaded = next;
      });
    }
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
    const actions = document.createElement("span");
    actions.className = "cm-embed-actions";
    header.append(open, status, actions, edit);

    const body = document.createElement("div");
    body.className = "cm-embed-body";
    body.textContent = "Loading…";
    root.append(header, body);
    controllers.set(root, new EmbedController(body, status, actions, this.inner, this.from, view));
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

type MediaShown = MediaKind | "player";
const imageCleanups = new WeakMap<HTMLElement, () => void>();

/** What a media embed's target shows as: a web video player, or by its extension. */
function shownAs(target: string): MediaShown {
  if (isWebUrl(target) && videoPlayerUrl(target)) return "player";
  return mediaKind(target) ?? "image"; // a web address without an extension: an image
}

const MEDIA_ICON: Record<MediaShown, string> = {
  image: "🖼",
  video: "🎞",
  audio: "🔊",
  player: "🎞",
};

/**
 * An image, video, audio file or web video on a line of its own: `![[photo.png|300]]`,
 * `![[clip.mp4]]`, `![alt](https://…/pic.jpg)`, `![](https://youtu.be/…)`. Clicking an
 * image shows its link for editing; players keep their clicks and get an "Edit link"
 * button instead.
 */
class MediaWidget extends WidgetType {
  readonly shown: MediaShown;
  constructor(
    readonly target: string,
    readonly width: number | null,
    readonly label: string,
    readonly from: string,
    readonly source: string,
    readonly readOnly: boolean,
  ) {
    super();
    this.shown = shownAs(target);
  }
  eq(other: MediaWidget) {
    return (
      other.target === this.target &&
      other.width === this.width &&
      other.label === this.label &&
      other.from === this.from &&
      other.source === this.source &&
      other.readOnly === this.readOnly
    );
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-image-embed cm-media-embed";
    wrap.dataset.kind = this.shown;
    const web = isWebUrl(this.target);
    const path = web ? null : resolveMedia(this.target, this.from, useAppStore.getState().tree);
    const url = web ? this.target.trim() : path ? backend.fileUrl(path) : null;
    const name = this.label || this.target;
    const editLink = () => {
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).to } });
      view.focus();
    };
    const failed = () => {
      wrap.replaceChildren(`Couldn't load ${this.target}`);
      wrap.classList.add("missing");
    };
    if (!url) {
      wrap.classList.add("missing");
      const icon = MEDIA_ICON[this.shown];
      wrap.textContent = path ? `${icon} ${this.target}` : `${icon} ${this.target} (not found)`;
      wrap.addEventListener("mousedown", (e) => {
        e.preventDefault();
        editLink();
      });
      return wrap;
    }
    if (this.shown === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      img.title = `${path ?? url} — Edit image to resize or crop`;
      if (this.width) img.width = this.width;
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", failed);
      imageCleanups.set(wrap, imageTools(view, wrap, img, this.source, editLink));
      return wrap;
    }
    let media: HTMLElement;
    if (this.shown === "player") {
      const frame = document.createElement("iframe");
      frame.src = videoPlayerUrl(url)!;
      frame.title = this.label || "Video";
      frame.loading = "lazy";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      // A page from another site: it runs its own player, with no way into the app.
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
      media = frame;
    } else {
      const el = document.createElement(this.shown); // <video> or <audio>
      el.controls = true;
      el.preload = "metadata";
      el.src = url;
      el.title = name;
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.addEventListener("loadedmetadata", () => view.requestMeasure());
      el.addEventListener("error", failed);
      media = el;
    }
    if (this.width) media.style.width = `${this.width}px`;
    const edit = document.createElement("button");
    edit.className = "cm-media-edit";
    edit.textContent = "Edit link";
    edit.title = path ?? url;
    edit.addEventListener("mousedown", (e) => {
      e.preventDefault();
      editLink();
    });
    wrap.append(media, edit);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) {
    imageCleanups.get(dom)?.();
    imageCleanups.delete(dom);
  }
  get estimatedHeight() {
    return this.shown === "audio" ? 54 : this.shown === "image" ? 200 : 300;
  }
}

/** The widget for a line that is only an embed (`![[…]]` or `![…](…)`), if it is one. */
function embedWidgetFor(text: string, from: string, readOnly: boolean): WidgetType | null {
  const { embed } = readImageLayout(text);
  const wiki = EMBED_LINE_RE.exec(embed);
  if (wiki) {
    const { target, width } = parseImageEmbed(wiki[1]!);
    return mediaKind(target)
      ? new MediaWidget(target, width, "", from, text, readOnly)
      : new EmbedWidget(wiki[1]!, from);
  }
  const md = parseMarkdownEmbed(embed);
  // A Markdown image of a note or other file stays as text.
  if (md && (isWebUrl(md.src) || mediaKind(md.src)))
    return new MediaWidget(md.src, md.width, md.alt, from, text, readOnly);
  return null;
}

function embedDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  if (!doc.toString().includes("![")) return Decoration.none;
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
    const widget = embedWidgetFor(line.text, from, state.readOnly);
    if (widget) out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
  }
  return Decoration.set(out);
}

const embedField = StateField.define<DecorationSet>({
  create: embedDecorations,
  update: (deco, tr) =>
    tr.docChanged || tr.selection || tr.reconfigured ? embedDecorations(tr.state) : deco,
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
