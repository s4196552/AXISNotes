import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Columns3,
  Redo2,
  Rows3,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Undo2,
} from "lucide-react";
import { formatNumber, isErr } from "../../lib/formula/evaluate";
import { colName, refName } from "../../lib/formula/parser";
import {
  type CellFormat,
  computeSheet,
  displayValue,
  emptySheet,
  parseSheet,
  serializeSheet,
  type SheetData,
  shiftSheet,
} from "../../lib/formula/sheet";
import { DocBanner } from "../files/DocBanner";
import { STATUS_TEXT, useFileDocument } from "../files/useFileDocument";
import {
  CLIP_MIME,
  type Clip,
  clampPos,
  clearRect,
  clipToBlock,
  copyRect,
  inRect,
  parseTsv,
  pasteBlock,
  type Pos,
  rectName,
  rectOf,
  type Selection,
  toTsv,
} from "./model";
import "./grid.css";

export const ROW_H = 26;
const ROW_HEAD_W = 48;
const DEFAULT_W = 100;
const MIN_W = 36;
const OVERSCAN = 10;
const HISTORY = 200;

interface Edit {
  /** Cell being edited (fixed when editing starts). */
  at: Pos;
  value: string;
  /** Where the text is typed. */
  from: "cell" | "bar";
  /** Started by typing over the cell: arrow keys commit and move, like Excel. */
  quick: boolean;
}

interface Doc {
  sheet: SheetData;
  undo: SheetData[];
  redo: SheetData[];
}

function titleOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.axgrid$/i, "");
}

export function Grid({ path }: { path: string }) {
  const [docState, setDocState] = useState<Doc>(() => ({
    sheet: emptySheet(),
    undo: [],
    redo: [],
  }));
  const { sheet } = docState;
  const [parseError, setParseError] = useState<string | null>(null);
  const file = useFileDocument(path, () => serializeSheet(sheet), parseError === null);
  const { markDirty } = file;

  // Take in the file whenever it is (re)loaded from disk.
  const [seenVersion, setSeenVersion] = useState(0);
  if (file.loadVersion !== seenVersion && file.text !== null) {
    setSeenVersion(file.loadVersion);
    try {
      setDocState({ sheet: parseSheet(file.text), undo: [], redo: [] });
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  const [sel, setSel] = useState<Selection>({ anchor: { c: 0, r: 0 }, focus: { c: 0, r: 0 } });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [resizing, setResizing] = useState<{ col: number; width: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const draggingSel = useRef(false);

  const computed = useMemo(() => computeSheet(sheet), [sheet]);
  const rect = rectOf(sel);
  const readOnly = parseError !== null;

  const width = (c: number) =>
    resizing?.col === c ? resizing.width : (sheet.widths[colName(c)] ?? DEFAULT_W);
  const lefts = useMemo(() => {
    const out = [0];
    for (let c = 0; c < sheet.cols; c++)
      out.push(
        out[c]! + (resizing?.col === c ? resizing.width : (sheet.widths[colName(c)] ?? DEFAULT_W)),
      );
    return out;
  }, [sheet.cols, sheet.widths, resizing]);

  // ---- Mutations (undoable) ----

  const apply = (fn: (s: SheetData) => SheetData) => {
    if (readOnly) return;
    const next = fn(docState.sheet);
    if (next === docState.sheet) return;
    setDocState({
      sheet: next,
      undo: [...docState.undo.slice(-HISTORY + 1), docState.sheet],
      redo: [],
    });
    markDirty();
  };

  const undo = () => {
    const prev = docState.undo.at(-1);
    if (!prev || readOnly) return;
    setDocState({ sheet: prev, undo: docState.undo.slice(0, -1), redo: [...docState.redo, sheet] });
    markDirty();
  };

  const redo = () => {
    const next = docState.redo.at(-1);
    if (!next || readOnly) return;
    setDocState({ sheet: next, undo: [...docState.undo, sheet], redo: docState.redo.slice(0, -1) });
    markDirty();
  };

  const setCell = (at: Pos, value: string) =>
    apply((s) => {
      const addr = refName(at.c, at.r);
      if ((s.cells[addr] ?? "") === value) return s;
      const cells = { ...s.cells };
      if (value === "") delete cells[addr];
      else cells[addr] = value;
      return { ...s, cells };
    });

  const formatSelection = (fn: (f: CellFormat) => CellFormat) =>
    apply((s) => {
      const formats = { ...s.formats };
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++) {
          const addr = refName(c, r);
          const f = fn(formats[addr] ?? {});
          if (!f.bold && !f.align) delete formats[addr];
          else formats[addr] = f;
        }
      return { ...s, formats };
    });

  const toggleBold = () => {
    const f = sheet.formats[refName(sel.focus.c, sel.focus.r)];
    const bold = !f?.bold;
    formatSelection((x) => {
      const next = { ...x };
      if (bold) next.bold = true;
      else delete next.bold;
      return next;
    });
  };

  const setAlign = (align: CellFormat["align"]) => {
    const current = sheet.formats[refName(sel.focus.c, sel.focus.r)]?.align;
    formatSelection((x) => {
      const next = { ...x };
      if (current === align) delete next.align;
      else next.align = align;
      return next;
    });
  };

  const insert = (axis: "row" | "col", after: boolean) => {
    const at = axis === "row" ? (after ? rect.r2 + 1 : rect.r1) : after ? rect.c2 + 1 : rect.c1;
    const count = axis === "row" ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1;
    apply((s) => shiftSheet(s, axis, at, count));
    if (!after) {
      // Keep the same content selected (it moved down/right).
      const d = axis === "row" ? { c: 0, r: count } : { c: count, r: 0 };
      setSel({
        anchor: { c: sel.anchor.c + d.c, r: sel.anchor.r + d.r },
        focus: { c: sel.focus.c + d.c, r: sel.focus.r + d.r },
      });
    }
  };

  const remove = (axis: "row" | "col") => {
    const at = axis === "row" ? rect.r1 : rect.c1;
    const count = axis === "row" ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1;
    const total = axis === "row" ? sheet.rows : sheet.cols;
    if (count >= total) return; // keep at least one
    apply((s) => shiftSheet(s, axis, at, -count));
    const p = clampPos(
      { c: axis === "col" ? at : sel.focus.c, r: axis === "row" ? at : sel.focus.r },
      {
        rows: sheet.rows - (axis === "row" ? count : 0),
        cols: sheet.cols - (axis === "col" ? count : 0),
      },
    );
    setSel({ anchor: p, focus: p });
  };

  const addRows = (n: number) => apply((s) => ({ ...s, rows: s.rows + n }));

  // ---- Selection and editing ----

  const moveTo = (p: Pos, extend = false) => {
    const q = clampPos(p, sheet);
    setSel((s) => (extend ? { anchor: s.anchor, focus: q } : { anchor: q, focus: q }));
  };

  const beginEdit = (initial?: string, from: Edit["from"] = "cell") => {
    if (readOnly) return;
    setEdit({
      at: sel.focus,
      value: initial ?? sheet.cells[refName(sel.focus.c, sel.focus.r)] ?? "",
      from,
      quick: initial !== undefined,
    });
  };

  /** Commit the edit, optionally moving the selection; returns focus to the grid. */
  const commitEdit = (move?: { dc: number; dr: number }, refocus = true) => {
    if (!edit) return;
    setEdit(null);
    setCell(edit.at, edit.value);
    if (move) moveTo({ c: edit.at.c + move.dc, r: edit.at.r + move.dr });
    if (refocus) bodyRef.current?.focus();
  };

  const cancelEdit = () => {
    setEdit(null);
    bodyRef.current?.focus();
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const arrows: Record<string, { dc: number; dr: number }> = {
      ArrowUp: { dc: 0, dr: -1 },
      ArrowDown: { dc: 0, dr: 1 },
      ArrowLeft: { dc: -1, dr: 0 },
      ArrowRight: { dc: 1, dr: 0 },
    };
    if (e.key === "Enter") commitEdit({ dc: 0, dr: e.shiftKey ? -1 : 1 });
    else if (e.key === "Tab") commitEdit({ dc: e.shiftKey ? -1 : 1, dr: 0 });
    else if (e.key === "Escape") cancelEdit();
    else if (edit?.quick && edit.from === "cell" && arrows[e.key]) commitEdit(arrows[e.key]);
    else return;
    e.preventDefault();
  };

  const onEditBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const to = e.relatedTarget as Node | null;
    // Moving between the cell input and the formula bar keeps editing.
    if (to && (to === barRef.current || (to as HTMLElement).classList?.contains("grid-input")))
      return;
    commitEdit(undefined, false);
  };

  const pageRows = Math.max(1, Math.floor(viewport.height / ROW_H) - 1);

  function onKeyDown(e: React.KeyboardEvent) {
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey;
    const f = sel.focus;
    const ext = e.shiftKey;
    switch (e.key) {
      case "ArrowUp":
        moveTo({ c: f.c, r: mod ? 0 : f.r - 1 }, ext);
        break;
      case "ArrowDown":
        moveTo({ c: f.c, r: mod ? sheet.rows - 1 : f.r + 1 }, ext);
        break;
      case "ArrowLeft":
        moveTo({ c: mod ? 0 : f.c - 1, r: f.r }, ext);
        break;
      case "ArrowRight":
        moveTo({ c: mod ? sheet.cols - 1 : f.c + 1, r: f.r }, ext);
        break;
      case "PageDown":
        moveTo({ c: f.c, r: f.r + pageRows }, ext);
        break;
      case "PageUp":
        moveTo({ c: f.c, r: f.r - pageRows }, ext);
        break;
      case "Home":
        moveTo({ c: 0, r: mod ? 0 : f.r }, ext);
        break;
      case "End":
        moveTo({ c: sheet.cols - 1, r: mod ? sheet.rows - 1 : f.r }, ext);
        break;
      case "Tab":
        moveTo({ c: f.c + (e.shiftKey ? -1 : 1), r: f.r });
        break;
      case "Enter":
        if (e.shiftKey) moveTo({ c: f.c, r: f.r - 1 });
        else beginEdit();
        break;
      case "F2":
        beginEdit();
        break;
      case "Delete":
      case "Backspace":
        apply((s) => clearRect(s, rect));
        break;
      case "Escape":
        setSel({ anchor: f, focus: f });
        break;
      default:
        if (mod && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === "b" && !e.shiftKey) toggleBold();
          else if (k === "z") (e.shiftKey ? redo : undo)();
          else if (k === "y") redo();
          else if (k === "a")
            setSel({ anchor: { c: 0, r: 0 }, focus: { c: sheet.cols - 1, r: sheet.rows - 1 } });
          else return;
        } else if (!mod && !e.altKey && e.key.length === 1) {
          beginEdit(e.key);
        } else {
          return;
        }
    }
    e.preventDefault();
  }

  // ---- Mouse ----

  const onCellMouseDown = (e: React.MouseEvent, p: Pos) => {
    if (e.button !== 0) return;
    if (edit) commitEdit(undefined, false);
    draggingSel.current = true;
    moveTo(p, e.shiftKey);
  };

  const onCellMouseEnter = (p: Pos) => {
    if (draggingSel.current) setSel((s) => ({ anchor: s.anchor, focus: p }));
  };

  const selectColumns = (e: React.MouseEvent, c: number) => {
    if (edit) commitEdit(undefined, false);
    const last = sheet.rows - 1;
    setSel((s) =>
      e.shiftKey
        ? { anchor: { c: s.anchor.c, r: 0 }, focus: { c, r: last } }
        : { anchor: { c, r: 0 }, focus: { c, r: last } },
    );
  };

  const selectRows = (e: React.MouseEvent, r: number) => {
    if (edit) commitEdit(undefined, false);
    const last = sheet.cols - 1;
    setSel((s) =>
      e.shiftKey
        ? { anchor: { c: 0, r: s.anchor.r }, focus: { c: last, r } }
        : { anchor: { c: 0, r }, focus: { c: last, r } },
    );
  };

  const startResize = (e: React.MouseEvent, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width(c);
    let latest = startW;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(MIN_W, Math.round(startW + ev.clientX - startX));
      setResizing({ col: c, width: latest });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(null);
      if (latest !== startW) commitWidth(c, latest);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  function commitWidth(c: number, w: number | null) {
    apply((s) => {
      const widths = { ...s.widths };
      if (w === null) delete widths[colName(c)];
      else widths[colName(c)] = w;
      return { ...s, widths };
    });
  }

  useEffect(() => {
    const up = () => (draggingSel.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ---- Clipboard (document-level: copy/paste events don't target plain divs) ----

  const onClipboard = useEffectEvent((e: ClipboardEvent) => {
    const body = bodyRef.current;
    if (!body || edit || !body.contains(document.activeElement) || !e.clipboardData) return;
    if (e.type === "paste") {
      if (readOnly) return;
      const at = { c: rect.c1, r: rect.r1 };
      let block: string[][];
      const custom = e.clipboardData.getData(CLIP_MIME);
      try {
        block = custom
          ? clipToBlock(JSON.parse(custom) as Clip, at)
          : parseTsv(e.clipboardData.getData("text/plain"));
      } catch {
        block = parseTsv(e.clipboardData.getData("text/plain"));
      }
      e.preventDefault();
      if (block.length === 0) return;
      apply((s) => pasteBlock(s, at, block));
      const w = Math.max(...block.map((l) => l.length));
      setSel({ anchor: at, focus: { c: at.c + w - 1, r: at.r + block.length - 1 } });
      return;
    }
    const rows: string[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const line: string[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) line.push(displayValue(computed.get(refName(c, r))));
      rows.push(line);
    }
    e.clipboardData.setData("text/plain", toTsv(rows));
    e.clipboardData.setData(CLIP_MIME, JSON.stringify(copyRect(sheet, rect)));
    e.preventDefault();
    if (e.type === "cut") apply((s) => clearRect(s, rect));
  });

  useEffect(() => {
    const handler = (e: ClipboardEvent) => onClipboard(e);
    document.addEventListener("copy", handler);
    document.addEventListener("cut", handler);
    document.addEventListener("paste", handler);
    return () => {
      document.removeEventListener("copy", handler);
      document.removeEventListener("cut", handler);
      document.removeEventListener("paste", handler);
    };
  }, []);

  // ---- Viewport (row virtualization) ----

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: el.clientHeight || v.height })),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the focused cell in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Scroll offsets are relative to the area under the sticky headers. When the cell is
    // bigger than that area, show its top-left corner.
    const scrollInto = (start: number, end: number, pos: number, view: number) =>
      start < pos || end - start > view ? start : end > pos + view ? end - view : pos;
    const top = sel.focus.r * ROW_H;
    el.scrollTop = scrollInto(top, top + ROW_H, el.scrollTop, el.clientHeight - ROW_H);
    const left = lefts[sel.focus.c]!;
    const right = lefts[sel.focus.c + 1]!;
    el.scrollLeft = scrollInto(left, right, el.scrollLeft, el.clientWidth - ROW_HEAD_W);
  }, [sel.focus, lefts]);

  const first = Math.max(0, Math.floor(viewport.top / ROW_H) - OVERSCAN);
  const last = Math.min(
    sheet.rows - 1,
    Math.ceil((viewport.top + viewport.height) / ROW_H) + OVERSCAN,
  );

  // ---- Derived display ----

  const focusAddr = refName(sel.focus.c, sel.focus.r);
  const barValue = edit ? edit.value : (sheet.cells[focusAddr] ?? "");
  const stats = useMemo(() => {
    if (rect.c1 === rect.c2 && rect.r1 === rect.r2) return null;
    let sum = 0;
    let count = 0;
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++) {
        const v = computed.get(refName(c, r));
        if (typeof v === "number") {
          sum += v;
          count++;
        }
      }
    return count > 0 ? { sum, count, avg: sum / count } : null;
  }, [computed, rect.c1, rect.c2, rect.r1, rect.r2]);

  const multi = rect.c1 !== rect.c2 || rect.r1 !== rect.r2;
  const totalWidth = ROW_HEAD_W + lefts[sheet.cols]!;
  const cols = Array.from({ length: sheet.cols }, (_, c) => c);

  const rows = [];
  for (let r = first; r <= last; r++) {
    rows.push(
      <div
        key={r}
        className="grid-row"
        role="row"
        aria-rowindex={r + 2}
        style={{ width: totalWidth }}
      >
        <div
          className={`grid-rowhead${r >= rect.r1 && r <= rect.r2 ? " hl" : ""}`}
          role="rowheader"
          onMouseDown={(e) => selectRows(e, r)}
        >
          {r + 1}
        </div>
        {cols.map((c) => {
          const addr = refName(c, r);
          const v = computed.get(addr);
          const fmt = sheet.formats[addr];
          const isFocus = sel.focus.c === c && sel.focus.r === r;
          const editingHere = edit?.from === "cell" && edit.at.c === c && edit.at.r === r;
          const selected = multi && inRect(rect, c, r);
          const align =
            fmt?.align ??
            (typeof v === "number" ? "right" : v !== undefined && isErr(v) ? "center" : undefined);
          const classes = [
            "grid-cell",
            isFocus && "focus",
            selected && "selected",
            fmt?.bold && "bold",
            align && `align-${align}`,
            v !== undefined && isErr(v) && "error",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={c}
              className={classes}
              role="gridcell"
              data-addr={addr}
              aria-selected={isFocus || selected}
              title={v !== undefined && isErr(v) && v.detail ? v.detail : undefined}
              style={{ width: width(c) }}
              onMouseDown={(e) => onCellMouseDown(e, { c, r })}
              onMouseEnter={() => onCellMouseEnter({ c, r })}
              onDoubleClick={() => beginEdit()}
            >
              {editingHere ? (
                <input
                  className="grid-input"
                  aria-label={`Edit ${addr}`}
                  autoFocus
                  value={edit.value}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  onKeyDown={onEditKey}
                  onBlur={onEditBlur}
                  onFocus={(e) => {
                    const n = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(n, n);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              ) : edit?.from === "bar" && edit.at.c === c && edit.at.r === r ? (
                edit.value
              ) : (
                displayValue(v)
              )}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div className="grid-view">
      <header className="editor-header grid-header">
        <h1 className="editor-title">{titleOf(path)}</h1>
        <span className={`editor-status status-${file.status}`} role="status" aria-live="polite">
          {STATUS_TEXT[file.status]}
        </span>
      </header>
      <DocBanner doc={file} noun="grid" />
      {parseError && (
        <div className="editor-banner" role="alert">
          <span>
            This grid file could not be read ({parseError}). It is shown read-only and will not be
            saved.
          </span>
        </div>
      )}

      <div className="grid-toolbar" role="toolbar" aria-label="Grid tools">
        <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!docState.undo.length}>
          <Undo2 size={15} />
        </ToolButton>
        <ToolButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!docState.redo.length}>
          <Redo2 size={15} />
        </ToolButton>
        <span className="grid-sep" />
        <ToolButton
          label="Bold (Ctrl+B)"
          onClick={toggleBold}
          pressed={!!sheet.formats[focusAddr]?.bold}
        >
          <Bold size={15} />
        </ToolButton>
        <ToolButton
          label="Align left"
          onClick={() => setAlign("left")}
          pressed={sheet.formats[focusAddr]?.align === "left"}
        >
          <TextAlignStart size={15} />
        </ToolButton>
        <ToolButton
          label="Align center"
          onClick={() => setAlign("center")}
          pressed={sheet.formats[focusAddr]?.align === "center"}
        >
          <TextAlignCenter size={15} />
        </ToolButton>
        <ToolButton
          label="Align right"
          onClick={() => setAlign("right")}
          pressed={sheet.formats[focusAddr]?.align === "right"}
        >
          <TextAlignEnd size={15} />
        </ToolButton>
        <span className="grid-sep" />
        <ToolButton label="Insert row above" onClick={() => insert("row", false)}>
          <BetweenHorizontalStart size={15} />
        </ToolButton>
        <ToolButton label="Insert row below" onClick={() => insert("row", true)}>
          <BetweenHorizontalEnd size={15} />
        </ToolButton>
        <ToolButton label="Delete rows" onClick={() => remove("row")}>
          <Rows3 size={15} />
        </ToolButton>
        <ToolButton label="Insert column left" onClick={() => insert("col", false)}>
          <BetweenVerticalStart size={15} />
        </ToolButton>
        <ToolButton label="Insert column right" onClick={() => insert("col", true)}>
          <BetweenVerticalEnd size={15} />
        </ToolButton>
        <ToolButton label="Delete columns" onClick={() => remove("col")}>
          <Columns3 size={15} />
        </ToolButton>
      </div>

      <div className="grid-formula-bar">
        <span className="grid-addr" aria-label="Selected range">
          {rectName(rect)}
        </span>
        <span className="grid-fx">fx</span>
        <input
          ref={barRef}
          className="grid-bar-input"
          aria-label="Formula bar"
          value={barValue}
          readOnly={readOnly}
          onFocus={() => {
            if (!edit) beginEdit(undefined, "bar");
            else if (edit.from === "cell") setEdit({ ...edit, from: "bar" });
          }}
          onChange={(e) => edit && setEdit({ ...edit, value: e.target.value })}
          onKeyDown={onEditKey}
          onBlur={onEditBlur}
        />
      </div>

      <div
        ref={bodyRef}
        className="grid-body"
        role="grid"
        aria-label={`Grid ${titleOf(path)}`}
        aria-rowcount={sheet.rows + 1}
        aria-colcount={sheet.cols + 1}
        aria-readonly={readOnly || undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          const el = e.currentTarget;
          setViewport({ top: el.scrollTop, height: el.clientHeight || viewport.height });
        }}
      >
        <div
          className="grid-row grid-headrow"
          role="row"
          aria-rowindex={1}
          style={{ width: totalWidth }}
        >
          <div
            className="grid-corner"
            role="columnheader"
            aria-label="Select all"
            onMouseDown={() =>
              setSel({ anchor: { c: 0, r: 0 }, focus: { c: sheet.cols - 1, r: sheet.rows - 1 } })
            }
          />
          {cols.map((c) => (
            <div
              key={c}
              className={`grid-colhead${c >= rect.c1 && c <= rect.c2 ? " hl" : ""}`}
              role="columnheader"
              style={{ width: width(c) }}
              onMouseDown={(e) => selectColumns(e, c)}
            >
              {colName(c)}
              <span
                className="grid-resize"
                aria-hidden
                onMouseDown={(e) => startResize(e, c)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  commitWidth(c, null);
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ height: first * ROW_H }} aria-hidden />
        {rows}
        <div style={{ height: (sheet.rows - 1 - last) * ROW_H }} aria-hidden />
        <div className="grid-more">
          <button onClick={() => addRows(100)} disabled={readOnly}>
            Add 100 rows
          </button>
        </div>
      </div>

      <footer className="grid-footer">
        <span>
          {sheet.rows} × {sheet.cols}
        </span>
        {stats && (
          <span className="grid-stats">
            Sum {formatNumber(stats.sum)} · Average {formatNumber(stats.avg)} · Count {stats.count}
          </span>
        )}
      </footer>
    </div>
  );
}

function ToolButton(props: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`editor-tool grid-tool${props.pressed ? " active" : ""}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      // Keep focus (and the selection) in the grid.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
