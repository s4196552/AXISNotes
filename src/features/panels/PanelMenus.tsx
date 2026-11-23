import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  type LucideIcon,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useFitToViewport } from "../../app/menuPosition";
import {
  moveToSide,
  PANEL_LABELS,
  removePanel,
  resetPlacement,
  type SidebarSide,
  updatePlacement,
  usePlacement,
} from "../../app/sidebarLayout";
import {
  closeMenu,
  movePanelTo,
  nudgePanel,
  openAddMenu,
  OTHER,
  SIDE_NAME,
  usePanelMenu,
} from "./panelCustomize";

// The sidebars' menus (T-275): each panel's (move, remove) and each sidebar's Add panel.

function Item({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        closeMenu();
        onClick();
      }}
    >
      <Icon size={15} className="menu-icon" aria-hidden="true" />
      {label}
    </button>
  );
}

/** A menu at x, y: Escape, a click outside or leaving the window closes it; ↑ ↓ move. */
function PopMenu({
  x,
  y,
  label,
  children,
}: {
  x: number;
  y: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFitToViewport(ref, x, y, `${x},${y}`);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, []);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu(false);
    };
    const blur = () => closeMenu(false);
    window.addEventListener("mousedown", outside);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <div
      ref={ref}
      className="filetree-menu panel-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** The menu open in this sidebar, if any: one panel's, or Add panel. */
export function SidebarMenu({ side }: { side: SidebarSide }) {
  const menu = usePanelMenu((s) => s.menu);
  const placement = usePlacement();
  if (!menu || menu.side !== side) return null;

  if (menu.kind === "panel") {
    const { id, group } = menu;
    const at = group.indexOf(id);
    const other = OTHER[side];
    return (
      <PopMenu x={menu.x} y={menu.y} label={`${PANEL_LABELS[id]} panel`}>
        <Item
          label="Move up"
          icon={ArrowUp}
          disabled={at <= 0}
          onClick={() => nudgePanel(id, group, -1)}
        />
        <Item
          label="Move down"
          icon={ArrowDown}
          disabled={at === -1 || at >= group.length - 1}
          onClick={() => nudgePanel(id, group, 1)}
        />
        <Item
          label={`Move to ${SIDE_NAME[other]}`}
          icon={other === "left" ? PanelLeft : PanelRight}
          onClick={() => movePanelTo(id, other)}
        />
        <Item
          label="Remove panel"
          icon={X}
          onClick={() => void updatePlacement((p) => removePanel(p, id))}
        />
      </PopMenu>
    );
  }

  const elsewhere = placement[OTHER[side]];
  return (
    <PopMenu x={menu.x} y={menu.y} label="Add panel">
      <div className="filetree-menu-label">Add panel</div>
      {placement.hidden.length === 0 && (
        <p className="panel-menu-note muted">Every panel is in a sidebar.</p>
      )}
      {placement.hidden.map((id) => (
        <Item
          key={id}
          label={PANEL_LABELS[id]}
          icon={Plus}
          onClick={() => void updatePlacement((p) => moveToSide(p, id, side))}
        />
      ))}
      {elsewhere.length > 0 && (
        <div className="filetree-menu-label">From the {SIDE_NAME[OTHER[side]]}</div>
      )}
      {elsewhere.map((id) => (
        <Item
          key={id}
          label={`Move ${PANEL_LABELS[id]} here`}
          icon={side === "left" ? PanelLeft : PanelRight}
          onClick={() => void updatePlacement((p) => moveToSide(p, id, side))}
        />
      ))}
      <div className="panel-menu-sep" role="separator" />
      <Item label="Reset sidebar layout" icon={RotateCcw} onClick={() => void resetPlacement()} />
    </PopMenu>
  );
}

/** The Add panel button for a sidebar. */
export function AddPanelButton({ side, className }: { side: SidebarSide; className?: string }) {
  const open = usePanelMenu((s) => s.menu?.kind === "add" && s.menu.side === side);
  return (
    <button
      type="button"
      className={className}
      aria-label={`Add panel to ${SIDE_NAME[side]}`}
      title="Add, move or reset panels"
      aria-haspopup="menu"
      aria-expanded={open}
      onMouseDown={(e) => open && e.stopPropagation()}
      onClick={(e) => (open ? closeMenu() : openAddMenu(e, side))}
    >
      <PanelsTopLeft size={15} aria-hidden="true" />
    </button>
  );
}
