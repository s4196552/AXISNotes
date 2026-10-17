import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Smile } from "lucide-react";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { backend } from "../../ipc";
import { resolveAttachment } from "../../lib/attachments";
import {
  COVER_COLORS,
  COVER_KEY,
  COVER_Y_KEY,
  type Cover,
  coverY,
  GRADIENTS,
  gradientCover,
  imageCover,
  parseCover,
  roundY,
} from "../../lib/cover";
import type { Props } from "../../lib/markdown";
import { useUi } from "../commands/ui";
import { EntryIcon } from "../icons/EntryIcon";
import { ImageChooser } from "../icons/ImageChooser";
import "../icons/icons.css";
import "./pageHeader.css";

/** One arrow-key step while repositioning a cover image. */
const KEY_STEP = 0.05;

/**
 * Notion-style page header above a note's title: its icon (the same custom icon the file
 * tree shows) and a cover banner from the frontmatter (see lib/cover.ts).
 */
export function PageHeader({
  path,
  props,
  onChange,
  compact = false,
}: {
  path: string;
  props: Props;
  onChange(next: Props): void;
  /** The note is scrolled: show the cover as a thin strip and hide the icon row. */
  compact?: boolean;
}) {
  const icon = useConfig((s) => s.config.folderIcons[path]);
  const cover = parseCover(props[COVER_KEY]);
  const [picking, setPicking] = useState(false);
  const openIcon = () => useUi.getState().open({ kind: "icon", path });

  const setCover = (value: string | null) => {
    const next = { ...props };
    // A new cover starts centred.
    delete next[COVER_Y_KEY];
    if (value === null) delete next[COVER_KEY];
    else next[COVER_KEY] = value;
    onChange(next);
    setPicking(false);
  };

  return (
    <div
      className={`page-header${cover ? " has-cover" : ""}${icon ? " has-icon" : ""}${
        compact && cover && !picking ? " compact" : ""
      }`}
    >
      {cover && (
        <CoverBanner
          path={path}
          cover={cover}
          y={coverY(props[COVER_Y_KEY])}
          onChangeCover={() => setPicking(true)}
          onRemove={() => setCover(null)}
          onSaveY={(y) => onChange({ ...props, [COVER_Y_KEY]: roundY(y) })}
        />
      )}
      <div className="page-meta">
        {icon && (
          <button className="page-icon" aria-label="Change page icon" onClick={openIcon}>
            <EntryIcon icon={icon} size={64} fallback={<FileText size={64} aria-hidden />} />
          </button>
        )}
        <div className="page-add">
          {!icon && (
            <button onClick={openIcon}>
              <Smile size={14} aria-hidden /> Add icon
            </button>
          )}
          {!cover && (
            <button onClick={() => setPicking(true)}>
              <ImageIcon size={14} aria-hidden /> Add cover
            </button>
          )}
        </div>
      </div>
      {picking && (
        <CoverPicker
          path={path}
          hasCover={!!cover}
          onPick={setCover}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function CoverBanner({
  path,
  cover,
  y,
  onChangeCover,
  onRemove,
  onSaveY,
}: {
  path: string;
  cover: Cover;
  y: number;
  onChangeCover(): void;
  onRemove(): void;
  onSaveY(y: number): void;
}) {
  const tree = useAppStore((s) => s.tree);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ startY: number; fromY: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The focus being chosen while repositioning, else null. */
  const [moving, setMoving] = useState<number | null>(null);

  const file = cover.kind === "image" ? resolveAttachment(cover.target, path, tree) : null;
  const url = file ? backend.fileUrl(file) : null;
  const showImage = !!url && failed !== url;
  const shownY = moving ?? y;

  useEffect(() => {
    if (moving !== null) box.current?.focus();
  }, [moving]);

  /** Fraction of the focus range one pixel of drag moves. */
  const perPixel = () => {
    const i = img.current;
    const b = box.current;
    if (!i || !b || !i.naturalWidth) return 0;
    const scale = Math.max(b.clientWidth / i.naturalWidth, b.clientHeight / i.naturalHeight);
    const spare = i.naturalHeight * scale - b.clientHeight;
    return spare > 1 ? 1 / spare : 0;
  };
  const clamp = (v: number) => roundY(v);

  const onPointerDown = (e: PointerEvent) => {
    if (moving === null || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startY: e.clientY, fromY: moving };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Dragging the picture down shows more of its top.
    setMoving(clamp(d.fromY - (e.clientY - d.startY) * perPixel()));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const save = () => {
    if (moving !== null) onSaveY(moving);
    setMoving(null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (moving === null) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setMoving(clamp(moving + (e.key === "ArrowUp" ? -KEY_STEP : KEY_STEP)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMoving(null);
    }
  };

  const background =
    cover.kind === "gradient" ? cover.css : cover.kind === "color" ? cover.color : undefined;

  return (
    <div
      ref={box}
      className={`page-cover${moving !== null ? " repositioning" : ""}`}
      style={background ? { background } : undefined}
      role={moving !== null ? "slider" : undefined}
      aria-label={moving !== null ? "Cover position" : undefined}
      aria-orientation={moving !== null ? "vertical" : undefined}
      aria-valuemin={moving !== null ? 0 : undefined}
      aria-valuemax={moving !== null ? 100 : undefined}
      aria-valuenow={moving !== null ? Math.round(moving * 100) : undefined}
      tabIndex={moving !== null ? 0 : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      {showImage && (
        <img
          ref={img}
          src={url}
          alt=""
          draggable={false}
          style={{ objectPosition: `center ${shownY * 100}%` }}
          onError={() => setFailed(url)}
        />
      )}
      {cover.kind === "image" && !showImage && (
        <p className="page-cover-note">
          {!file
            ? `Cover image not found: ${cover.target}`
            : url
              ? `Couldn't load ${file}`
              : `The cover ${file} shows in the desktop app.`}
        </p>
      )}
      {cover.kind === "remote" && (
        <p className="page-cover-note">
          Web images aren't loaded, so your notes stay offline. Save the image into the vault and
          choose it as the cover.
        </p>
      )}
      {moving !== null && (
        <span className="page-cover-hint">Drag the image or use ↑ ↓ to reposition</span>
      )}
      <div className="page-cover-actions">
        {moving !== null ? (
          <>
            <button onClick={save}>Save position</button>
            <button onClick={() => setMoving(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={onChangeCover}>Change cover</button>
            {showImage && <button onClick={() => setMoving(y)}>Reposition</button>}
            <button onClick={onRemove}>Remove cover</button>
          </>
        )}
      </div>
    </div>
  );
}

function CoverPicker({
  path,
  hasCover,
  onPick,
  onClose,
}: {
  path: string;
  hasCover: boolean;
  onPick(value: string | null): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState<"gallery" | "images">("gallery");
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={panel}
      className="cover-picker"
      role="dialog"
      aria-label="Choose a cover"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="cover-picker-top">
        <div role="tablist" className="icon-tabs">
          <button
            role="tab"
            aria-selected={tab === "gallery"}
            onClick={() => setTab("gallery")}
            autoFocus
          >
            Gallery
          </button>
          <button role="tab" aria-selected={tab === "images"} onClick={() => setTab("images")}>
            Images
          </button>
        </div>
        {hasCover && (
          <button className="cover-remove" onClick={() => onPick(null)}>
            Remove
          </button>
        )}
      </div>
      {tab === "gallery" ? (
        <div className="cover-gallery">
          <div className="icon-section">Gradients</div>
          <div className="cover-tiles" role="listbox" aria-label="Gradients">
            {Object.entries(GRADIENTS).map(([name, g]) => (
              <button
                key={name}
                role="option"
                aria-selected={false}
                aria-label={g.label}
                title={g.label}
                style={{ background: g.css }}
                onClick={() => onPick(gradientCover(name))}
              />
            ))}
          </div>
          <div className="icon-section">Colours</div>
          <div className="cover-tiles" role="listbox" aria-label="Colours">
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                role="option"
                aria-selected={false}
                aria-label={`Colour ${c}`}
                title={c}
                style={{ background: c }}
                onClick={() => onPick(c)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="cover-images">
          <input
            aria-label="Filter images"
            placeholder="Search images…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ImageChooser forPath={path} query={query} onPick={(p) => onPick(imageCover(p))} />
        </div>
      )}
    </div>
  );
}
