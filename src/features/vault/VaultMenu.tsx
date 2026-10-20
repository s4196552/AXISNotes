import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { recentVaults } from "../../app/recentVaults";
import { useUi } from "../commands/ui";
import { createVaultFromMenu, openVaultFolder, revealVault, switchVault } from "./vaultSwitch";
import "./vaultMenu.css";

/**
 * The vault's name at the top of the sidebar, as a menu: other recent vaults, open or
 * create one, show this one in the file manager, and its settings.
 */
export function VaultMenu() {
  const vault = useAppStore((s) => s.vault);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", close);
    };
  }, [pos]);

  const others = pos ? recentVaults().filter((r) => r.root !== vault?.root) : [];
  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <button
        ref={button}
        className="sidebar-vault vault-button"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        title={vault?.root}
        onClick={() => {
          if (pos) return close();
          const r = button.current!.getBoundingClientRect();
          setPos({ left: r.left, top: r.bottom + 4 });
        }}
      >
        <span className="vault-name">{vault?.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {pos && (
        <div
          ref={menu}
          className="vault-menu"
          role="menu"
          aria-label="Vaults"
          style={pos}
          onKeyDown={(e) => {
            const items = [
              ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
            ];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              close();
              button.current?.focus();
            } else if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
            else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
            else return;
            e.preventDefault();
          }}
        >
          {others.length > 0 && (
            <>
              <div className="vault-menu-label" role="presentation">
                Switch to
              </div>
              {others.map((r) => (
                <button
                  key={r.root}
                  role="menuitem"
                  title={r.root}
                  onClick={act(() => void switchVault(r.root))}
                >
                  <BookOpen size={14} aria-hidden="true" />
                  <span className="vault-menu-text">
                    {r.name}
                    <span className="muted">{r.root}</span>
                  </span>
                </button>
              ))}
              <div className="vault-menu-sep" role="separator" />
            </>
          )}
          <button role="menuitem" onClick={act(() => void openVaultFolder())}>
            <FolderOpen size={14} aria-hidden="true" /> Open folder as vault…
          </button>
          <button role="menuitem" onClick={act(() => void createVaultFromMenu())}>
            <FolderPlus size={14} aria-hidden="true" /> Create new vault…
          </button>
          <div className="vault-menu-sep" role="separator" />
          <button role="menuitem" onClick={act(revealVault)}>
            <FolderSearch size={14} aria-hidden="true" /> Show vault in File Explorer
          </button>
          <button role="menuitem" onClick={act(() => useUi.getState().open({ kind: "settings" }))}>
            <SettingsIcon size={14} aria-hidden="true" /> Vault settings
          </button>
        </div>
      )}
    </>
  );
}
