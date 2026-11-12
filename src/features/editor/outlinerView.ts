import { indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentListItem, moveBlock, outlineFolding } from "./outliner";

// Keyboard outlining is always on (Tab/Shift-Tab, Alt+↑/↓, fold keys). "Outline view"
// adds a fold gutter. Line controls are available in both modes.

export const outlinerKeys = [
  outlineFolding,
  Prec.high(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const spec = indentListItem(view.state, 1);
          if (spec) view.dispatch(spec);
          return spec !== null || (indentWithTab.run?.(view) ?? false);
        },
        shift: (view) => {
          const spec = indentListItem(view.state, -1);
          if (spec) view.dispatch(spec);
          return spec !== null || (indentWithTab.shift?.(view) ?? false);
        },
      },
      {
        key: "Alt-ArrowUp",
        run: (view) => {
          const spec = moveBlock(view.state, -1);
          if (spec) view.dispatch(spec);
          return spec !== null;
        },
      },
      {
        key: "Alt-ArrowDown",
        run: (view) => {
          const spec = moveBlock(view.state, 1);
          if (spec) view.dispatch(spec);
          return spec !== null;
        },
      },
    ]),
  ),
  keymap.of(foldKeymap),
];

export const outlineView = foldGutter();
