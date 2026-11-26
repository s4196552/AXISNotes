import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  BookPlus,
  Circle,
  ClipboardPaste,
  ClipboardType,
  Copy,
  EyeOff,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  type LucideProps,
  MessageSquare,
  Palette,
  Pilcrow,
  Scissors,
  SeparatorHorizontal,
  Sigma,
  Sparkles,
  SpellCheck,
  SquareCode,
  SquarePlus,
  Strikethrough,
  Superscript,
  Table,
  TextQuote,
  TextSelect,
  Type,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { clipboardReadAllowed, readClipboardText } from "../../ipc/clipboard";
import { useFitToViewport } from "../../app/menuPosition";
import { ContextMenu, MenuGroup, MenuItem, SubMenu } from "../filetree/ContextMenu";
import "../filetree/filetree.css";
import { type ChatContext, openSidebarChat } from "../ai/sidebarChatState";
import type { SpellingFix } from "../spellcheck";
import { getActiveEditor } from "./activeEditor";
import { CODE_COLORS, type CodeColor, codeColorClass } from "./codeColors";
import { pastedMedia, pasteFiles } from "./media";
import {
  copyRange,
  colorSelection,
  cutRange,
  formatSelection,
  insertBlock,
  type ParagraphKind,
  paragraphKind,
  pasteText,
  plainText,
  selectionColor,
  toggleParagraph,
} from "./editorMenuActions";

// The note's right-click menu (T-288), in the human's layout: Format ▸, Paragraph ▸ and
// Insert ▸ act on the selection (or at the caret), then the clipboard, then the AI items
// the menu had before. On a misspelled word its fixes come first.

const HEADINGS: [ParagraphKind, LucideIcon][] = [
  ["h1", Heading1],
  ["h2", Heading2],
  ["h3", Heading3],
  ["h4", Heading4],
  ["h5", Heading5],
  ["h6", Heading6],
];

const COLOR_NAMES: Record<CodeColor, string> = {
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
  red: "Red",
  violet: "Violet",
  blue: "Blue",
};

/** A filled dot in a text colour, as a menu icon. */
const swatches = new Map<CodeColor, LucideIcon>();
function swatch(color: CodeColor): LucideIcon {
  let icon = swatches.get(color);
  if (!icon) {
    icon = forwardRef<SVGSVGElement, LucideProps>(function Swatch(props, ref) {
      return (
        <Circle
          ref={ref}
          {...props}
          fill="currentColor"
          className={`${props.className ?? ""} ${codeColorClass(color)}`}
        />
      );
    }) as LucideIcon;
    swatches.set(color, icon);
  }
  return icon;
}

/**
 * Image, video or audio files on the clipboard, when the page may read them without a
 * permission prompt (in the app only Ctrl+V pastes media; Paste here pastes the text).
 */
async function clipboardFiles(): Promise<File[]> {
  if (!(await clipboardReadAllowed())) return [];
  try {
    const items = await navigator.clipboard.read();
    const data = new DataTransfer();
    for (const item of items)
      for (const type of item.types)
        if (/^(image|video|audio)\//.test(type)) {
          const blob = await item.getType(type);
          data.items.add(new File([blob], `Pasted.${type.split("/")[1]}`, { type }));
        }
    return pastedMedia(data);
  } catch {
    return [];
  }
}

export function NoteContextMenu({
  x,
  y,
  context,
  view: given,
  spelling,
  onClose,
}: {
  x: number;
  y: number;
  context: ChatContext;
  /** The editor the menu is for (else the active one). */
  view?: EditorView;
  /** The misspelled word right-clicked, if any. */
  spelling?: SpellingFix | null;
  onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  // Fitted again when the spelling suggestions arrive and make the menu taller.
  useFitToViewport(menuRef, x, y, suggestions);
  useEffect(() => {
    let live = true;
    void spelling?.suggest().then((s) => live && setSuggestions(s));
    return () => {
      live = false;
    };
  }, [spelling]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [onClose]);

  /** The note's editor, if it is still the one the menu was opened on. */
  const editor = (): EditorView | null => {
    if (given) return given.dom.isConnected ? given : null;
    const active = getActiveEditor();
    return active?.path === context.path ? active.view : null;
  };
  const view = editor();
  const state = view?.state;
  const kind = state ? paragraphKind(state) : null;
  const color = state ? selectionColor(state) : null;
  const run = (action: (v: EditorView) => unknown) => () => {
    const v = editor();
    if (!v) return useAppStore.getState().notify("The note was closed. Open it again.");
    action(v);
  };
  const clipboardError = (e: unknown) =>
    useAppStore
      .getState()
      .notify(`Couldn't use the clipboard: ${e instanceof Error ? e.message : String(e)}`);
  const copy = (cut: boolean) =>
    run((v) => {
      const { text } = copyRange(v.state);
      void navigator.clipboard.writeText(text).then(() => {
        if (cut) cutRange(v);
        else v.focus();
      }, clipboardError);
    });
  const paste = (plain: boolean) =>
    run(async (v) => {
      try {
        const files = plain ? [] : await clipboardFiles();
        if (files.length) {
          v.focus();
          return void pasteFiles(v, files);
        }
        const text = await readClipboardText();
        pasteText(v, plain ? plainText(text) : text);
      } catch (e) {
        clipboardError(e);
      }
    });
  const label = context.selection ? "selection" : "note";
  /** Close the menu and put the caret back in the note (Escape, Tab). */
  const close = () => {
    onClose();
    editor()?.focus();
  };

  return createPortal(
    <div className="note-menu-layer">
      <ContextMenu x={x} y={y} label="Note actions" menuRef={menuRef} close={close}>
        {spelling && (
          <MenuGroup label={`Spelling: ${spelling.word}`}>
            {suggestions === null && <div className="note-menu-note">Looking for suggestions…</div>}
            {suggestions?.length === 0 && <div className="note-menu-note">No suggestions</div>}
            {suggestions?.map((s) => (
              <MenuItem key={s} label={s} icon={SpellCheck} onClick={() => spelling.replace(s)} />
            ))}
            <MenuItem
              label={`Add “${spelling.word}” to dictionary`}
              icon={BookPlus}
              onClick={() => spelling.addToDictionary()}
            />
            <MenuItem label="Ignore" icon={EyeOff} onClick={() => spelling.ignore()} />
          </MenuGroup>
        )}
        <MenuGroup>
          <SubMenu label="Format" icon={Type}>
            <MenuItem label="Bold" icon={Bold} onClick={run((v) => formatSelection(v, "bold"))} />
            <MenuItem
              label="Italic"
              icon={Italic}
              onClick={run((v) => formatSelection(v, "italic"))}
            />
            <MenuItem
              label="Strikethrough"
              icon={Strikethrough}
              onClick={run((v) => formatSelection(v, "strikethrough"))}
            />
            <MenuItem
              label="Highlight"
              icon={Highlighter}
              onClick={run((v) => formatSelection(v, "highlight"))}
            />
            <SubMenu label="Color" icon={Palette}>
              {CODE_COLORS.map((c) => (
                <MenuItem
                  key={c}
                  label={COLOR_NAMES[c]}
                  icon={swatch(c)}
                  checked={color === c}
                  onClick={run((v) => colorSelection(v, c))}
                />
              ))}
            </SubMenu>
          </SubMenu>
          <SubMenu label="Paragraph" icon={Pilcrow}>
            <MenuGroup>
              <MenuItem
                label="Bulleted List"
                icon={List}
                checked={kind === "bullet"}
                onClick={run((v) => toggleParagraph(v, "bullet"))}
              />
              <MenuItem
                label="Numbered List"
                icon={ListOrdered}
                checked={kind === "numbered"}
                onClick={run((v) => toggleParagraph(v, "numbered"))}
              />
              <MenuItem
                label="Task List"
                icon={ListTodo}
                checked={kind === "task"}
                onClick={run((v) => toggleParagraph(v, "task"))}
              />
            </MenuGroup>
            <MenuGroup>
              {HEADINGS.map(([h, icon], i) => (
                <MenuItem
                  key={h}
                  label={`Heading ${i + 1}`}
                  icon={icon}
                  checked={kind === h}
                  onClick={run((v) => toggleParagraph(v, h))}
                />
              ))}
            </MenuGroup>
            <MenuGroup>
              <MenuItem
                label="Quote"
                icon={TextQuote}
                checked={kind === "quote"}
                onClick={run((v) => toggleParagraph(v, "quote"))}
              />
            </MenuGroup>
          </SubMenu>
          <SubMenu label="Insert" icon={SquarePlus}>
            <MenuGroup>
              <MenuItem
                label="Footnote"
                icon={Superscript}
                onClick={run((v) => insertBlock(v, "footnote"))}
              />
              <MenuItem label="Table" icon={Table} onClick={run((v) => insertBlock(v, "table"))} />
              <MenuItem
                label="Callout"
                icon={Info}
                onClick={run((v) => insertBlock(v, "callout"))}
              />
              <MenuItem
                label="Divider"
                icon={SeparatorHorizontal}
                onClick={run((v) => insertBlock(v, "divider"))}
              />
            </MenuGroup>
            <MenuGroup>
              <MenuItem
                label="Code Block"
                icon={SquareCode}
                onClick={run((v) => insertBlock(v, "code"))}
              />
              <MenuItem
                label="Math Block"
                icon={Sigma}
                onClick={run((v) => insertBlock(v, "math"))}
              />
            </MenuGroup>
          </SubMenu>
        </MenuGroup>
        <MenuGroup>
          <MenuItem label="Cut" icon={Scissors} onClick={copy(true)} />
          <MenuItem label="Copy" icon={Copy} onClick={copy(false)} />
          <MenuItem label="Paste" icon={ClipboardPaste} onClick={paste(false)} />
          <MenuItem label="Paste as plain text" icon={ClipboardType} onClick={paste(true)} />
          <MenuItem
            label="Select All"
            icon={TextSelect}
            onClick={run((v) => {
              v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
              v.focus();
            })}
          />
        </MenuGroup>
        <MenuGroup label="AI">
          <MenuItem
            label={`Ask AI about this ${label}`}
            icon={Sparkles}
            onClick={() => openSidebarChat(context, `Explain this ${label}.`)}
          />
          <MenuItem
            label={`Send ${label} to AI chat`}
            icon={MessageSquare}
            onClick={() => openSidebarChat(context)}
          />
        </MenuGroup>
      </ContextMenu>
    </div>,
    document.body,
  );
}
