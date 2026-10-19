import { type ReactNode, useEffect, useState } from "react";
import { FolderOpen, FileArchive } from "lucide-react";
import type { Pack, PackKind } from "../../ipc";
import { backend } from "../../ipc";
import { matchesPackFile, packCount, packFileLabel, usePacks } from "./packs";
import "../icons/icons.css";
import "./packs.css";

const WHAT: Record<PackKind, string> = { icons: "icon pack", images: "image pack" };

/** "Add an icon pack: From folder… From .zip…", with progress and errors. */
export function AddPack({ kind, onAdded }: { kind: PackKind; onAdded?(pack: Pack): void }) {
  const add = usePacks((s) => s.add);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const run = async (from: "folder" | "zip") => {
    setError("");
    setAdded("");
    setBusy(true);
    try {
      const pack = await add(kind, from);
      if (pack) {
        setAdded(`Added “${pack.name}” (${packCount(pack)}).`);
        onAdded?.(pack);
      }
    } catch (e) {
      setError(`Couldn't add the ${WHAT[kind]}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pack-add">
      <span className="pack-add-label">
        {busy ? `Adding ${WHAT[kind]}…` : `Add an ${WHAT[kind]}:`}
      </span>
      <button onClick={() => void run("folder")} disabled={busy}>
        <FolderOpen size={14} aria-hidden /> From folder…
      </button>
      <button onClick={() => void run("zip")} disabled={busy}>
        <FileArchive size={14} aria-hidden /> From .zip…
      </button>
      {error && (
        <p className="icon-note" role="alert">
          {error}
        </p>
      )}
      {added && !error && (
        <p className="icon-note" role="status">
          {added}
        </p>
      )}
    </div>
  );
}

/**
 * A pack image at `size`. With a `color`, it's drawn as a silhouette in that colour (a CSS
 * mask), which suits one-colour icon packs; without, as the image itself.
 */
export function PackImage({
  path,
  size,
  color,
  className = "",
  fallback = null,
}: {
  path: string;
  size: number;
  color?: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const url = backend.fileUrl(path);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <>{fallback}</>;
  if (!color) {
    return (
      <img
        className={className}
        src={url}
        alt=""
        width={size}
        height={size}
        draggable={false}
        loading="lazy"
        onError={() => setFailed(url)}
      />
    );
  }
  const mask = `url("${url.replace(/"/g, "%22")}") center / contain no-repeat`;
  return (
    <span
      className={`${className} tinted-icon`}
      style={{ width: size, height: size, backgroundColor: color, mask, WebkitMask: mask }}
      aria-hidden
    >
      {/* Only here to notice a missing file; the mask above does the drawing. */}
      <img src={url} alt="" hidden onError={() => setFailed(url)} />
    </span>
  );
}

/** The colour that one-colour pack icons get unless another is chosen: the text's. */
export const TEXT_COLOR = "currentColor";

/** Pack icons per page of results, as in the icon picker's Lucide set. */
const PAGE = 240;

/** The icon picker's Packs tab: every icon pack, searchable, plus adding a new one. */
export function IconPacks({
  query,
  color,
  selected,
  onPick,
}: {
  query: string;
  color: string;
  /** Vault path of the icon in use, if it's from a pack. */
  selected: string | null;
  /** `monochrome`: the icon's pack is one-colour, so with no colour it follows the text. */
  onPick(path: string, monochrome: boolean): void;
}) {
  const { packs, loaded, error, load } = usePacks();
  // Paging starts over whenever the search changes.
  const [paging, setPaging] = useState({ query, limit: PAGE });
  const limit = paging.query === query ? paging.limit : PAGE;
  useEffect(() => {
    void load();
  }, [load]);

  const iconPacks = packs.filter((p) => p.kind === "icons");
  const sections = iconPacks.map((p) => ({
    pack: p,
    files: p.files.filter((f) => matchesPackFile(f, query)),
  }));
  const shown: typeof sections = [];
  let left = limit;
  for (const s of sections) {
    const files = s.files.slice(0, Math.max(0, left));
    left -= files.length;
    shown.push({ ...s, files });
  }
  const total = sections.reduce((n, s) => n + s.files.length, 0);
  const visible = shown.reduce((n, s) => n + s.files.length, 0);

  return (
    <>
      {error && (
        <p className="icon-note" role="alert">
          Couldn't read the vault's packs: {error}
        </p>
      )}
      {loaded && iconPacks.length === 0 && (
        <p className="icon-note">
          No icon packs yet. Add a folder or .zip of SVG or PNG icons; one-colour SVGs can take any
          colour.
        </p>
      )}
      {shown.map(
        ({ pack, files }) =>
          files.length > 0 && (
            <div key={pack.name}>
              <div className="icon-section pack-section-head">
                {pack.name} <span className="muted">{packCount(pack)}</span>
              </div>
              <div className="icon-grid" role="listbox" aria-label={`Icons in ${pack.name}`}>
                {files.map((f) => (
                  <button
                    key={f}
                    role="option"
                    aria-selected={selected === f}
                    aria-label={packFileLabel(f)}
                    title={packFileLabel(f)}
                    onClick={() => onPick(f, pack.monochrome)}
                  >
                    <PackImage
                      path={f}
                      size={18}
                      color={color || (pack.monochrome ? TEXT_COLOR : undefined)}
                    />
                  </button>
                ))}
              </div>
            </div>
          ),
      )}
      {total > visible && (
        <button className="icon-more" onClick={() => setPaging({ query, limit: limit + PAGE })}>
          Show more ({(total - visible).toLocaleString()} left)
        </button>
      )}
      {loaded && iconPacks.length > 0 && query && total === 0 && (
        <p className="icon-note">No pack icons match “{query}”.</p>
      )}
      <AddPack kind="icons" />
    </>
  );
}

/** Image-pack pictures shown per pack in the cover gallery before "Show all". */
const COVERS_SHOWN = 24;

/** The cover gallery's image packs, one section each, plus adding a new one. */
export function ImagePacks({ onPick }: { onPick(path: string): void }) {
  const { packs, error, load } = usePacks();
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    void load();
  }, [load]);
  const imagePacks = packs.filter((p) => p.kind === "images");

  return (
    <>
      {error && (
        <p className="icon-note" role="alert">
          Couldn't read the vault's packs: {error}
        </p>
      )}
      {imagePacks.map((pack) => {
        const all = open.has(pack.name);
        const files = all ? pack.files : pack.files.slice(0, COVERS_SHOWN);
        return (
          <div key={pack.name}>
            <div className="icon-section pack-section-head">
              {pack.name} <span className="muted">{packCount(pack)}</span>
            </div>
            <div className="cover-tiles" role="listbox" aria-label={`Covers in ${pack.name}`}>
              {files.map((f) => (
                <button
                  key={f}
                  className="cover-pack-tile"
                  role="option"
                  aria-selected={false}
                  aria-label={packFileLabel(f)}
                  title={packFileLabel(f)}
                  onClick={() => onPick(f)}
                >
                  <CoverThumb path={f} />
                </button>
              ))}
            </div>
            {!all && pack.files.length > COVERS_SHOWN && (
              <button
                className="icon-more"
                onClick={() => setOpen((s) => new Set(s).add(pack.name))}
              >
                Show all {pack.files.length.toLocaleString()}
              </button>
            )}
          </div>
        );
      })}
      <AddPack kind="images" />
    </>
  );
}

function CoverThumb({ path }: { path: string }) {
  const url = backend.fileUrl(path);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="cover-pack-img missing" aria-hidden />;
  return (
    <img
      className="cover-pack-img"
      src={url}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
