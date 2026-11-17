import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { Zap } from "lucide-react";
import { formatDate } from "../../lib/dates";
import { toggleMarkInText } from "./inlineMarks";
import { lucideSvg } from "./lucideSvg";
import { noteIconOptions, renderIconCompletion } from "./noteIconOptions";
import {
  COMMAND_GROUPS,
  type CommandIcon,
  commandSectionHeader,
  escapeRe,
  loadEmoji,
  type QuickCommandConfig,
  quickCommandConfig,
  searchEmoji,
  SLASH_COMMANDS,
} from "./quickCommands";

// The command menu (Ctrl+/) and `:` emoji and icons while a table cell is being edited.
// A cell is a plain text field (tables.ts), so CodeMirror's own menus can't open there;
// this draws the same menu under the cell, with only what fits on one line of a Markdown
// table: text styles, links, embeds, dates, priorities and your own quick commands. What
// it inserts never has a line break (`<br>` instead), and `|` is escaped when the cell is
// written back (`tableCellSource`).

/** What choosing an item does to the cell text: wrap the selection in a mark, or insert. */
export type CellAction = { mark: string } | { text: string; cursor?: number };

export interface CellMenuItem {
  id: string;
  label: string;
  section: string;
  description?: string;
  /** The Markdown hint on the right, like the note's command menu. */
  hint?: string;
  icon?: CommandIcon;
  /** An inline icon (`lucide:…` or an icon pack file), drawn before the label. */
  iconTarget?: string;
  action: CellAction;
}

/** The commands that make sense inside a table cell, with what each inserts there. */
const CELL_ACTIONS: Record<string, () => CellAction> = {
  bold: () => ({ mark: "**" }),
  italic: () => ({ mark: "*" }),
  strikethrough: () => ({ mark: "~~" }),
  "inline-code": () => ({ text: "``", cursor: 1 }),
  link: () => ({ text: "[[]]", cursor: 2 }),
  embed: () => ({ text: "![[]]", cursor: 3 }),
  "web-embed": () => ({ text: "![]()", cursor: 4 }),
  date: () => ({ text: formatDate(new Date(), "YYYY-MM-DD") }),
  time: () => ({ text: formatDate(new Date(), "HH:mm") }),
  due: () => ({ text: `📅 ${formatDate(new Date(), "YYYY-MM-DD")}` }),
  "priority-high": () => ({ text: "⏫" }),
  "priority-medium": () => ({ text: "🔼" }),
  "priority-low": () => ({ text: "🔽" }),
};

export const CUSTOM_SECTION = "Custom";
export const FILTERED_SECTION = "Filtered results";

/** Text for one table cell: line breaks become `<br>`, the way tables write them. */
export const oneLine = (text: string) => text.replace(/\r?\n/g, "<br>");

/** How well `label` matches `query` (lower is better), or null when it doesn't. */
function score(label: string, query: string): number | null {
  const l = label.toLowerCase();
  const q = query.toLowerCase().trim();
  if (l.startsWith(q)) return 0;
  if (l.split(/[\s:·-]+/).some((w) => w.startsWith(q))) return 1;
  return l.includes(q) ? 2 : null;
}

/**
 * The command menu's items for a table cell. With nothing typed they come in the note
 * menu's sections and order; typed, the matches are ranked under "Filtered results".
 */
export function cellCommandItems(cfg: QuickCommandConfig, query = ""): CellMenuItem[] {
  const all: CellMenuItem[] = [];
  for (const group of COMMAND_GROUPS) {
    for (const id of group.ids) {
      const make = CELL_ACTIONS[id];
      const command = SLASH_COMMANDS.find((c) => c.id === id);
      if (!make || !command || cfg.disabled.includes(id)) continue;
      all.push({
        id,
        label: command.label,
        section: group.name,
        description: command.description,
        hint: command.markdown,
        icon: command.icon,
        action: make(),
      });
    }
  }
  cfg.custom.forEach((c, i) => {
    const raw = oneLine(c.insert);
    const at = raw.indexOf("{{cursor}}");
    const text = raw.replace("{{cursor}}", "");
    all.push({
      id: `custom-${i}`,
      label: c.label,
      section: CUSTOM_SECTION,
      description: text.trim(),
      icon: Zap,
      action: at === -1 ? { text } : { text, cursor: at },
    });
  });
  if (!query.trim()) return all;
  return all
    .map((item) => ({ item, rank: score(item.label, query) }))
    .filter((x): x is { item: CellMenuItem; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => ({ ...item, section: FILTERED_SECTION }));
}

/** Emoji and icons for `:query` in a cell (the ones that insert text: no "Add icon…"). */
export async function cellEmojiItems(query: string): Promise<CellMenuItem[]> {
  const [data, icons] = await Promise.all([loadEmoji(), noteIconOptions(query)]);
  const emoji = searchEmoji(data, query, query ? 40 : 4).map(({ emoji, name }): CellMenuItem => ({
    id: `emoji-${emoji}`,
    label: `${emoji}  ${name.replace(/_/g, " ")}`,
    section: "Emoji",
    action: { text: emoji },
  }));
  const iconItems = icons
    .filter((c): c is Completion & { apply: string } => typeof c.apply === "string")
    .map((c): CellMenuItem => ({
      id: `icon-${c.apply}`,
      label: c.label,
      section: typeof c.section === "string" ? c.section : (c.section?.name ?? "Icons"),
      hint: c.detail,
      iconTarget: (c as Completion & { iconTarget?: string }).iconTarget,
      action: { text: oneLine(c.apply) },
    }));
  return [...emoji, ...iconItems];
}

/** The cell text and selection after replacing from..to (the typed menu text) with `action`. */
export function applyCellAction(
  value: string,
  from: number,
  to: number,
  action: CellAction,
  selection: { from: number; to: number } = { from, to },
): { text: string; from: number; to: number } {
  if ("mark" in action) {
    // The typed `/query` goes; the selection (now shifted) is what gets the mark.
    const removed = to - from;
    const shift = (p: number) => (p >= to ? p - removed : Math.min(p, from));
    const text = value.slice(0, from) + value.slice(to);
    return toggleMarkInText(text, shift(selection.from), shift(selection.to), action.mark);
  }
  const insert = oneLine(action.text);
  const at = from + Math.min(action.cursor ?? insert.length, insert.length);
  return { text: value.slice(0, from) + insert + value.slice(to), from: at, to: at };
}

type Kind = "commands" | "emoji";

let menuIds = 0;

/**
 * The menu for one cell's text field. Ctrl+/ opens the command menu (and a typed trigger,
 * when one is set in Settings); the emoji trigger opens emoji and icons. What's typed after
 * filters it, ↑↓ choose, Enter or Tab insert, Escape closes it. `write` takes the new cell
 * text, like typing does.
 */
export class TableCellMenu {
  private el: HTMLElement | null = null;
  private kind: Kind = "commands";
  /** Where the replaced text starts (the trigger, if typed) and where the query starts. */
  private start = 0;
  private typedFrom = 0;
  /** The selection when Ctrl+/ was pressed: a style command applies to it. */
  private selection = { from: 0, to: 0 };
  private items: CellMenuItem[] = [];
  private selected = 0;
  private request = 0;
  /** The cell text when the menu opened. */
  private base = "";
  readonly id = `cm-table-cell-menu-${++menuIds}`;

  constructor(
    readonly input: HTMLTextAreaElement,
    readonly view: EditorView,
    readonly anchor: HTMLElement,
    readonly write: (value: string) => void,
  ) {}

  get open() {
    return this.el !== null;
  }

  private get cfg() {
    return this.view.state.facet(quickCommandConfig);
  }

  /** Open the command menu at the cursor (Ctrl+/). */
  openCommands() {
    const { selectionStart: from, selectionEnd: to } = this.input;
    this.selection = { from, to };
    this.show("commands", to, to);
  }

  /** After the text changed: filter the open menu, close it, or open one for a trigger. */
  update() {
    const caret = this.input.selectionStart;
    const before = this.input.value.slice(0, caret);
    if (this.el) {
      const typed = before.slice(this.typedFrom);
      const valid =
        caret >= this.typedFrom &&
        // Unchanged up to the menu (typing over a selection replaces what was there).
        this.input.value.slice(0, this.typedFrom) === this.base.slice(0, this.typedFrom) &&
        (this.kind === "commands" ? /^[\w ]{0,24}$/ : /^[a-z0-9_+-]*$/i).test(typed);
      if (valid) return this.refresh();
      this.close();
    }
    const cfg = this.cfg;
    if (cfg.slashTrigger) {
      const m = new RegExp(`(?:^|\\s)(${escapeRe(cfg.slashTrigger)})([\\w ]{0,24})$`).exec(before);
      if (m) {
        const at = caret - m[1]!.length - m[2]!.length;
        this.selection = { from: at, to: at };
        return this.show("commands", at, at + m[1]!.length);
      }
    }
    if (cfg.emojiTrigger && cfg.emojiTrigger !== cfg.slashTrigger) {
      // The boundary keeps 10:30 from opening it.
      const m = new RegExp(`(?:^|[\\s(])(${escapeRe(cfg.emojiTrigger)})[a-z0-9_+-]*$`, "i").exec(
        before,
      );
      if (m) {
        const at = m.index + m[0].indexOf(m[1]!);
        this.show("emoji", at, at + m[1]!.length);
      }
    }
  }

  /** Keys while the menu is open; true when the menu used the key. */
  keydown(event: KeyboardEvent): boolean {
    if (!this.el) return false;
    const count = this.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count)
        this.choose((this.selected + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && count) {
      event.preventDefault();
      this.apply(this.items[this.selected]!);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return true;
    }
    return false;
  }

  close() {
    this.request++;
    this.el?.remove();
    this.el = null;
    this.input.removeAttribute("aria-controls");
    this.input.removeAttribute("aria-activedescendant");
    this.input.removeAttribute("aria-expanded");
  }

  private show(kind: Kind, start: number, typedFrom: number) {
    this.close();
    this.kind = kind;
    this.start = start;
    this.typedFrom = typedFrom;
    this.base = this.input.value;
    const el = document.createElement("div");
    el.className = "cm-tooltip cm-tooltip-autocomplete cm-table-cell-menu";
    // Inside the editor, so the menu has the editor theme's look.
    this.view.dom.append(el);
    this.el = el;
    this.input.setAttribute("aria-controls", this.id);
    this.input.setAttribute("aria-expanded", "true");
    this.refresh();
  }

  private refresh() {
    const query = this.input.value.slice(this.typedFrom, this.input.selectionStart);
    const request = ++this.request;
    if (this.kind === "commands") return this.draw(cellCommandItems(this.cfg, query));
    void cellEmojiItems(query).then(
      (items) => {
        if (request === this.request && this.el) this.draw(items);
      },
      () => {},
    );
  }

  private draw(items: CellMenuItem[]) {
    const el = this.el;
    if (!el) return;
    this.items = items;
    this.selected = 0;
    const list = document.createElement("ul");
    list.id = this.id;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", this.kind === "commands" ? "Commands" : "Emoji and icons");
    let section: string | null = null;
    items.forEach((item, i) => {
      if (item.section !== section) {
        section = item.section;
        list.append(commandSectionHeader(section));
      }
      const li = document.createElement("li");
      li.id = `${this.id}-${i}`;
      li.setAttribute("role", "option");
      if (item.icon) {
        const icon = document.createElement("span");
        icon.className = "cm-commandIcon";
        if (Array.isArray(item.icon)) {
          const [small, main] = item.icon;
          icon.append(lucideSvg(small!, 10), lucideSvg(main!));
        } else icon.append(lucideSvg(item.icon as Exclude<CommandIcon, readonly unknown[]>));
        li.append(icon);
      } else if (item.iconTarget) {
        const preview = renderIconCompletion({
          label: item.label,
          iconTarget: item.iconTarget,
        } as Completion);
        if (preview) li.append(preview);
      }
      const label = document.createElement("span");
      label.className = "cm-completionLabel";
      label.textContent = item.label;
      li.append(label);
      if (item.icon && item.description) {
        const description = document.createElement("div");
        description.className = "cm-commandDescription";
        description.textContent = item.description;
        li.append(description);
      }
      if (item.hint) {
        const hint = document.createElement(item.icon ? "kbd" : "span");
        hint.className = item.icon ? "cm-commandMarkdown" : "cm-completionDetail";
        hint.textContent = item.hint;
        li.append(hint);
      }
      // Keep the cell's text field focused (and its selection) while choosing.
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => this.apply(item));
      li.addEventListener("mousemove", () => this.choose(i, false));
      list.append(li);
    });
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "cm-table-cell-menu-empty";
      empty.setAttribute("aria-disabled", "true");
      empty.textContent = "No matches";
      list.append(empty);
    }
    el.replaceChildren(list);
    this.choose(0);
    this.place();
  }

  private choose(i: number, scroll = true) {
    if (!this.el) return;
    this.selected = i;
    this.el.querySelectorAll("li[role=option]").forEach((li, k) => {
      if (k === i) {
        li.setAttribute("aria-selected", "true");
        this.input.setAttribute("aria-activedescendant", li.id);
        if (scroll) li.scrollIntoView?.({ block: "nearest" });
      } else li.removeAttribute("aria-selected");
    });
  }

  /** Under the cell, or above it when there's no room below. */
  private place() {
    const el = this.el!;
    const box = this.anchor.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - 340))}px`;
    el.style.top = `${box.bottom + 2}px`;
    const height = el.getBoundingClientRect().height;
    if (box.bottom + 2 + height > window.innerHeight && box.top - height - 2 > 0)
      el.style.top = `${box.top - height - 2}px`;
  }

  private apply(item: CellMenuItem) {
    const input = this.input;
    const to = Math.max(input.selectionStart, this.typedFrom);
    const next = applyCellAction(input.value, this.start, to, item.action, this.selection);
    this.close();
    input.value = next.text;
    input.setSelectionRange(next.from, next.to);
    this.write(input.value);
  }
}
