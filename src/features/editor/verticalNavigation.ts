import { EditorSelection, type SelectionRange } from "@codemirror/state";
import { type BlockInfo, BlockType, type EditorView, keymap } from "@codemirror/view";

function textBlock(line: BlockInfo): BlockInfo | undefined {
  if (line.type === BlockType.Text) return line;
  if (typeof line.type !== "number") return line.type.find((part) => part.type === BlockType.Text);
}

/** Find the next editable row, including blank lines and skipping replaced blocks. */
function adjacentText(view: EditorView, current: BlockInfo, direction: 1 | -1) {
  const beyond = (line: BlockInfo) => (direction === 1 ? line.to + 1 : line.from - 1);
  for (let pos = beyond(current); pos >= 0 && pos <= view.state.doc.length;) {
    const line = view.lineBlockAt(pos);
    const text = textBlock(line);
    if (text) return text;
    pos = beyond(line);
  }
}

function move(view: EditorView, range: SelectionRange, direction: 1 | -1): SelectionRange {
  const current = view.lineBlockAt(range.head);
  const moved = view.moveVertically(range, direction === 1);
  const inside = (block: BlockInfo) => moved.head >= block.from && moved.head <= block.to;
  // CodeMirror handles wrapped rows, bidirectional text and the remembered visual column.
  if (inside(current) && (moved.head - range.head) * direction > 0) return moved;
  const next = adjacentText(view, current, direction);
  if (!next) return range;
  if (inside(next)) return moved;

  // Padding or a block widget can make coordinate-based movement skip the neighboring row.
  // Target that row directly, using its last wrapped row when traveling up.
  const goal = range.goalColumn ?? moved.goalColumn;
  const edge = view.coordsAtPos(direction === 1 ? next.from : next.to, direction);
  if (edge && goal != null) {
    const pos = view.posAtCoords({
      x: view.contentDOM.getBoundingClientRect().left + goal,
      y: (edge.top + edge.bottom) / 2,
    });
    if (pos != null && pos >= next.from && pos <= next.to)
      return EditorSelection.cursor(pos, 0, undefined, goal);
  }
  const column = range.head - view.state.doc.lineAt(range.head).from;
  return EditorSelection.cursor(Math.min(next.from + column, next.to), 0, undefined, goal);
}

function vertical(direction: 1 | -1, extend = false) {
  return (view: EditorView) => {
    const { selection } = view.state;
    const ranges = selection.ranges.map((range) => {
      if (!extend && !range.empty)
        return EditorSelection.cursor(direction === 1 ? range.to : range.from);
      const target = move(view, range, direction);
      return extend
        ? EditorSelection.range(
            range.anchor,
            target.head,
            target.goalColumn,
            undefined,
            target.assoc,
          )
        : target;
    });
    view.dispatch({
      selection: EditorSelection.create(ranges, selection.mainIndex),
      scrollIntoView: true,
      userEvent: "select.keyboard",
    });
    return true;
  };
}

export const verticalNavigation = keymap.of(
  (["ArrowUp", "ArrowDown"] as const).flatMap((key, index) => {
    const direction = index === 0 ? -1 : 1;
    const run = vertical(direction);
    const shift = vertical(direction, true);
    return [
      { key, run, shift },
      { key: `Ctrl-${key}`, run, shift },
    ];
  }),
);
