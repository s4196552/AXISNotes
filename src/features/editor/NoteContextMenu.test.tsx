import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpellingFix } from "../spellcheck";
import { NoteContextMenu } from "./NoteContextMenu";

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function setup(doc: string, from: number, to = from, spelling: SpellingFix | null = null) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
  const onClose = vi.fn();
  const context = {
    root: "/vault",
    path: "Note.md",
    doc,
    from: from === to ? 0 : from,
    to: from === to ? doc.length : to,
    text: from === to ? doc : doc.slice(from, to),
    selection: from !== to,
  };
  render(
    <NoteContextMenu
      x={10}
      y={10}
      context={context}
      view={view}
      spelling={spelling}
      onClose={onClose}
    />,
  );
  return { v: view, onClose };
}

/** The items of a menu itself, by name, with the lines between its groups as "---". */
function layout(menu: HTMLElement): string[] {
  const out: string[] = [];
  const groups = menu.querySelectorAll(":scope > [role=group]");
  for (const group of groups.length ? groups : [menu]) {
    if (out.length) out.push("---");
    for (const item of group.querySelectorAll("[role^=menuitem]"))
      if (item.closest("[role=menu]") === menu)
        out.push(item.querySelector(".menu-label")!.textContent!);
  }
  return out;
}

describe("note right-click menu", () => {
  it("has the human's layout, with the AI items kept at the end", () => {
    setup("Some text", 0, 4);
    const menu = screen.getByRole("menu", { name: "Note actions" });
    expect(layout(menu)).toEqual([
      "Format",
      "Paragraph",
      "Insert",
      "---",
      "Cut",
      "Copy",
      "Paste",
      "Paste as plain text",
      "Select All",
      "---",
      "Ask AI about this selection",
      "Send selection to AI chat",
    ]);
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Paragraph" }).parentElement!);
    expect(layout(screen.getByRole("menu", { name: "Paragraph" }))).toEqual([
      "Bulleted List",
      "Numbered List",
      "Task List",
      "---",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "---",
      "Quote",
    ]);
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Insert" }).parentElement!);
    expect(screen.queryByRole("menu", { name: "Paragraph" })).toBeNull();
    expect(layout(screen.getByRole("menu", { name: "Insert" }))).toEqual([
      "Footnote",
      "Table",
      "Callout",
      "Divider",
      "---",
      "Code Block",
      "Math Block",
    ]);
  });

  it("opens Format ▸ Color by keyboard and colours the selection", () => {
    const { v, onClose } = setup("say hello", 4, 9);
    const menu = screen.getByRole("menu", { name: "Note actions" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const format = screen.getByRole("menuitem", { name: "Format" });
    expect(document.activeElement).toBe(format);
    fireEvent.keyDown(format, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Format" });
    expect(layout(sub)).toEqual(["Bold", "Italic", "Strikethrough", "Highlight", "Color"]);
    expect(document.activeElement).toBe(within(sub).getByRole("menuitem", { name: "Bold" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    const color = within(sub).getByRole("menuitem", { name: "Color" });
    expect(document.activeElement).toBe(color);
    fireEvent.keyDown(color, { key: "Enter" });
    const colors = screen.getByRole("menu", { name: "Color" });
    expect(layout(colors)).toEqual(["Green", "Yellow", "Orange", "Red", "Violet", "Blue"]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Color" })).toBeNull();
    expect(document.activeElement).toBe(color);
    fireEvent.keyDown(color, { key: "ArrowRight" });
    fireEvent.click(within(screen.getByRole("menu", { name: "Color" })).getByText("Blue"));
    expect(v.state.doc.toString()).toBe("say `blue`hello``");
    expect(onClose).toHaveBeenCalled();
  });

  it("marks the line's current paragraph type and toggles it off", () => {
    const { v } = setup("## Title", 4);
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Paragraph" }).parentElement!);
    const h2 = screen.getByRole("menuitemradio", { name: "Heading 2" });
    expect(h2).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Heading 3" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(h2);
    expect(v.state.doc.toString()).toBe("Title");
  });

  it("puts a misspelled word's fixes first", async () => {
    const fix: SpellingFix = {
      word: "teh",
      from: 0,
      to: 3,
      suggest: () => Promise.resolve(["the", "ten"]),
      replace: vi.fn(),
      addToDictionary: vi.fn(),
      ignore: vi.fn(),
    };
    setup("teh cat", 1, 1, fix);
    await act(async () => {});
    const menu = screen.getByRole("menu", { name: "Note actions" });
    expect(layout(menu).slice(0, 5)).toEqual([
      "the",
      "ten",
      "Add “teh” to dictionary",
      "Ignore",
      "---",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "the" }));
    expect(fix.replace).toHaveBeenCalledWith("the");
  });

  it("pastes plain text without its formatting", async () => {
    const readText = vi.fn(() => Promise.resolve("**bold** <i>x</i>"));
    Object.assign(navigator, {
      clipboard: { readText, read: () => Promise.reject(new Error("no")) },
    });
    const { v } = setup("a b", 2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste as plain text" }));
    await vi.waitFor(() => expect(v.state.doc.toString()).toBe("a bold xb"));
  });
});
