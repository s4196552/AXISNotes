import {
  type Completion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
} from "@codemirror/autocomplete";
import { type EditorState, Prec } from "@codemirror/state";
import { type EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { lucideSvg } from "./lucideSvg";
import { SECTION_ICONS } from "./quickCommands";
import { skillSectionCategory } from "../skills/skillGroups";

// The command menu's jump bar: a row of its sections (Basic blocks, Text style, Links…)
// with their icons, above the list. Clicking one, or ← and →, jumps to that section's first
// item; ↑ and ↓ still move through the items. Shown while the menu lists more than one
// section, so not while filtering (one "Filtered results" section) or for other menus.

const sectionName = (c: Completion) => {
  const name = typeof c.section === "string" ? c.section : (c.section?.name ?? "");
  return skillSectionCategory(name) ? "Skills" : name;
};

export interface MenuSection {
  name: string;
  /** The index of its first option in the list. */
  index: number;
}

/** The open command menu's sections in order, or null when there's no jump bar. */
export function menuSections(state: EditorState): MenuSection[] | null {
  if (completionStatus(state) !== "active") return null;
  const options = currentCompletions(state);
  if (!options.length || !options.every((c) => "commandIcon" in c)) return null;
  const out: MenuSection[] = [];
  options.forEach((c, index) => {
    const name = sectionName(c);
    if (out[out.length - 1]?.name !== name) out.push({ name, index });
  });
  return out.length > 1 ? out : null;
}

/** Which section holds the selected option. */
function currentSection(sections: MenuSection[], selected: number): number {
  let at = 0;
  sections.forEach((s, i) => {
    if (s.index <= selected) at = i;
  });
  return at;
}

/** Select the first option of the section `step` away (wrapping around). */
export function jumpSection(view: EditorView, step: number): boolean {
  const sections = menuSections(view.state);
  if (!sections) return false;
  const now = currentSection(sections, selectedCompletionIndex(view.state) ?? 0);
  const next = (now + step + sections.length) % sections.length;
  jumpTo(view, sections[next]!.index);
  return true;
}

function jumpTo(view: EditorView, index: number) {
  view.dispatch({ effects: setSelectedCompletion(index) });
  revealSection(view);
}

/** Scroll the list so the selected section's heading is at the top. */
function revealSection(view: EditorView) {
  queueMicrotask(() => {
    const list = view.dom.querySelector<HTMLElement>(".cm-tooltip-autocomplete > ul");
    const head = list?.querySelector("[aria-selected=true]")?.previousElementSibling;
    if (!list || head?.tagName.toLowerCase() !== "completion-section") return;
    list.scrollTop += head.getBoundingClientRect().top - list.getBoundingClientRect().top;
  });
}

/** Keep the bar in the menu's tooltip in step with its sections and selection. */
function sync(view: EditorView) {
  const tooltip = view.dom.querySelector<HTMLElement>(".cm-tooltip-autocomplete");
  const sections = menuSections(view.state);
  const bar = tooltip?.querySelector<HTMLElement>(":scope > .cm-commandTabs");
  if (!tooltip || !sections) {
    bar?.remove();
    return;
  }
  const key = sections.map((s) => `${s.name}@${s.index}`).join("|");
  let el = bar;
  if (!el || el.dataset.key !== key) {
    el?.remove();
    el = document.createElement("div");
    el.className = "cm-commandTabs";
    el.dataset.key = key;
    el.setAttribute("role", "toolbar");
    el.setAttribute("aria-label", "Jump to a section (← →)");
    for (const s of sections) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-commandTab";
      b.dataset.section = s.name;
      b.title = s.name;
      const icon = SECTION_ICONS[s.name];
      if (icon) b.append(lucideSvg(icon, 13));
      const label = document.createElement("span");
      label.textContent = s.name;
      b.append(label);
      // Keep the editor focused, so typing and the arrow keys still drive the menu.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => jumpTo(view, s.index));
      el.append(b);
    }
    tooltip.prepend(el);
  }
  const active = currentSection(sections, selectedCompletionIndex(view.state) ?? 0);
  el.querySelectorAll<HTMLElement>(".cm-commandTab").forEach((b, i) => {
    const on = i === active;
    if (on) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
    if (on && el.scrollWidth > el.clientWidth)
      b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

const bar = ViewPlugin.define((view) => {
  // Right after each update, once every plugin (the menu's tooltip too) has drawn. Not
  // through the measure cycle, which waits for an animation frame.
  let queued = false;
  let gone = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!gone) sync(view);
    });
  };
  schedule();
  return {
    update: schedule,
    destroy() {
      gone = true;
    },
  };
});

/** The jump bar and its keys (← → while the command menu is open). */
export const commandMenuTabs = [
  bar,
  Prec.highest(
    keymap.of([
      { key: "ArrowRight", run: (view) => jumpSection(view, 1) },
      { key: "ArrowLeft", run: (view) => jumpSection(view, -1) },
    ]),
  ),
];
