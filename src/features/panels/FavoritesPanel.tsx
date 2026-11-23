import { useRef } from "react";
import { File, FileText, Folder, Shapes, Sheet, X } from "lucide-react";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { showPanel } from "../../app/sidebarLayout";
import { dropBeside, usePointerDrag } from "../../app/usePointerDrag";
import { docKind } from "../../lib/fileKinds";
import type { VaultEntry } from "../../ipc";
import { registerCommands } from "../commands/registry";
import { EntryIcon } from "../icons/EntryIcon";
import { findEntry } from "../filetree/treeModel";
import { favoriteName, openFavorite } from "./favoriteActions";
import { addFavorites, isFavorite, moveFavorite, removeFavorite } from "./favorites";

function KindIcon({ path, entry }: { path: string; entry: VaultEntry | null }) {
  if (entry?.kind === "dir") return <Folder size={14} aria-hidden="true" />;
  const kind = docKind(path);
  const Icon =
    kind === "markdown" ? FileText : kind === "grid" ? Sheet : kind === "canvas" ? Shapes : File;
  return <Icon size={14} aria-hidden="true" />;
}

/**
 * The Favorites section's list: click to open, drag (or Alt+↑ / Alt+↓) to reorder, × to
 * remove. A favorite that was deleted or moved outside the app shows as missing.
 */
export function FavoritesList() {
  const favorites = useConfig((s) => s.config.favorites);
  const tree = useAppStore((s) => s.tree);
  const activePath = useAppStore((s) => (s.mainView === "note" ? s.activePath : null));
  const folderIcons = useConfig((s) => s.config.folderIcons);
  const list = useRef<HTMLUListElement>(null);
  const { press, dragging, target } = usePointerDrag(
    (x, y, path: string) => dropBeside(list.current, "data-fav-path", x, y, path),
    (path, at) => {
      const before = at.after ? (favorites[favorites.indexOf(at.target) + 1] ?? null) : at.target;
      if (before !== path) void moveFavorite(path, before);
    },
  );

  if (favorites.length === 0) {
    return (
      <p className="panel-note muted fav-empty">
        Right-click a note or folder in the file tree and choose Add to favorites.
      </p>
    );
  }

  const nudge = (path: string, step: number) => {
    const at = favorites.indexOf(path);
    const to = at + step;
    if (to < 0 || to >= favorites.length) return;
    void moveFavorite(path, step > 0 ? (favorites[to + 1] ?? null) : favorites[to]!).then(() =>
      requestAnimationFrame(() =>
        [...(list.current?.querySelectorAll<HTMLElement>("[data-fav-path]") ?? [])]
          .find((li) => li.dataset.favPath === path)
          ?.querySelector<HTMLElement>(".fav-item")
          ?.focus(),
      ),
    );
  };

  return (
    <ul className="fav-list" aria-label="Favorites" ref={list}>
      {favorites.map((path) => {
        const entry = findEntry(tree, path);
        const name = favoriteName(path);
        const icon = folderIcons[path];
        return (
          <li
            key={path}
            className="fav-row"
            data-fav-path={path}
            data-dragging={dragging === path ? "" : undefined}
            data-drop={target?.target === path ? (target.after ? "after" : "before") : undefined}
          >
            <button
              type="button"
              className={[
                "fav-item",
                entry ? "" : "missing",
                activePath === path ? "active" : "",
              ].join(" ")}
              title={
                entry
                  ? `${path} — drag to reorder`
                  : `${path} (missing — deleted or moved outside AXISNotes)`
              }
              aria-current={activePath === path ? "page" : undefined}
              onPointerDown={(e) => press(e, path)}
              onDragStart={(e) => e.preventDefault()}
              onClick={(e) => openFavorite(path, e.ctrlKey || e.metaKey)}
              onKeyDown={(e) => {
                if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                nudge(path, e.key === "ArrowUp" ? -1 : 1);
              }}
            >
              {icon ? (
                <EntryIcon
                  icon={icon}
                  size={14}
                  fallback={<KindIcon path={path} entry={entry} />}
                />
              ) : (
                <KindIcon path={path} entry={entry} />
              )}
              <span className="fav-name">{name}</span>
              {!entry && <span className="fav-missing muted">missing</span>}
            </button>
            <button
              type="button"
              className="fav-remove"
              aria-label={`Remove ${name} from favorites`}
              title="Remove from favorites"
              onClick={() => void removeFavorite(path)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const openFilePath = () => {
  const s = useAppStore.getState();
  return s.mainView === "note" ? s.activePath : null;
};

registerCommands([
  {
    id: "favorite-add",
    label: "Add open file to favorites",
    available: () => {
      const p = openFilePath();
      return p !== null && !isFavorite(p);
    },
    run: () => {
      const p = openFilePath();
      if (p) void addFavorites([p]);
    },
  },
  {
    id: "favorite-remove",
    label: "Remove open file from favorites",
    available: () => {
      const p = openFilePath();
      return p !== null && isFavorite(p);
    },
    run: () => {
      const p = openFilePath();
      if (p) void removeFavorite(p);
    },
  },
  { id: "show-favorites", label: "Show favorites", run: () => void showPanel("favorites") },
]);
