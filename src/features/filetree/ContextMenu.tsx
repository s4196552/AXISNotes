import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

// The file tree's right-click menus (T-287): items in groups divided by a line, and
// submenus that open on hover, click, → or Enter. ↑ ↓ Home End move between items, ← and
// Escape close a submenu, and Escape closes the menu.

interface Level {
  /** The submenu open at this level (its id), if any. */
  open: string | null;
  setOpen(id: string | null): void;
  /** Close the whole menu. */
  close(): void;
}

/** Space kept between a submenu and the window's edge, in CSS pixels. */
const EDGE = 8;

const LevelContext = createContext<Level>({ open: null, setOpen() {}, close() {} });

/** The items of `menu` itself, not those of its submenus. */
function ownItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")].filter(
    (el) => el.closest("[role=menu]") === menu,
  );
}

/** Arrow keys, Home and End within one menu; `back` for ← and Escape. */
function onMenuKey(e: React.KeyboardEvent, menu: HTMLElement, back: () => void) {
  const target = e.target as HTMLElement;
  if (target !== menu && target.closest("[role=menu]") !== menu) return;
  const items = ownItems(menu);
  const at = items.indexOf(target);
  const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
  switch (e.key) {
    case "ArrowDown":
      focus(at + 1);
      break;
    case "ArrowUp":
      focus(at < 0 ? -1 : at - 1);
      break;
    case "Home":
      focus(0);
      break;
    case "End":
      focus(-1);
      break;
    case "ArrowLeft":
    case "Escape":
      back();
      break;
    case "Tab":
      // A menu is one stop: Tab leaves it.
      back();
      return;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

/** The open submenu at one level, and closing the whole menu, for the items in it. */
function useLevel(close: () => void): Level {
  const [open, setOpen] = useState<string | null>(null);
  return useMemo(() => ({ open, setOpen, close }), [open, close]);
}

/**
 * A right-click menu at x, y. It takes focus when it opens, so ↓ reaches the first item;
 * `close` is called after an item runs and on Escape.
 */
export function ContextMenu(props: {
  x: number;
  y: number;
  label?: string;
  menuRef: RefObject<HTMLDivElement | null>;
  close(): void;
  children: ReactNode;
}) {
  const { menuRef, close } = props;
  const level = useLevel(close);
  useEffect(() => {
    menuRef.current?.focus({ preventScroll: true });
  }, [menuRef]);
  return (
    <div
      ref={menuRef}
      className="filetree-menu"
      role="menu"
      aria-label={props.label}
      tabIndex={-1}
      style={{ left: props.x, top: props.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => onMenuKey(e, e.currentTarget, close)}
    >
      <LevelContext.Provider value={level}>{props.children}</LevelContext.Provider>
    </div>
  );
}

/** Items that belong together. A line divides each group from the one before it. */
export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="filetree-menu-section">
      {children}
    </div>
  );
}

export function MenuItem(props: {
  label: string;
  /** Shown before the label, like the command palette's icons. */
  icon: LucideIcon;
  danger?: boolean;
  /** For a choice among several (AI access): this one is the current one. */
  checked?: boolean;
  onClick(): void;
}) {
  const level = useContext(LevelContext);
  const radio = props.checked !== undefined;
  return (
    <button
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? props.checked : undefined}
      tabIndex={-1}
      className={props.danger ? "danger" : undefined}
      // Pointing at another item closes a submenu open at this level.
      onMouseEnter={() => level.setOpen(null)}
      onClick={() => {
        level.close();
        props.onClick();
      }}
    >
      <props.icon size={15} className="menu-icon" aria-hidden />
      <span className="menu-label">{props.label}</span>
      {radio && (
        <span className="menu-check" aria-hidden>
          {props.checked ? "✓" : ""}
        </span>
      )}
    </button>
  );
}

/** An item that opens more items beside it. */
export function SubMenu(props: { label: string; icon: LucideIcon; children: ReactNode }) {
  const parent = useContext(LevelContext);
  const level = useLevel(parent.close);
  const id = useId();
  const open = parent.open === id;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    const trig = trigger.current?.getBoundingClientRect();
    // No room on the right: open on the left of the item instead.
    if (trig && r.right > window.innerWidth - EDGE && trig.left - r.width >= EDGE)
      el.classList.add("on-left");
    // Past the bottom of the window: up as far as needed (not past the top). Taller than
    // the window (a long list of skills): from the top, scrolling.
    const room = window.innerHeight - 2 * EDGE;
    if (r.height > room) {
      el.style.maxHeight = `${room}px`;
      el.style.overflowY = "auto";
    }
    const over = Math.min(r.bottom - (window.innerHeight - EDGE), r.top - EDGE);
    if (over > 0) el.style.top = `calc(-5px - ${over}px)`;
    if (focusFirst.current) {
      focusFirst.current = false;
      ownItems(el)[0]?.focus();
    }
  }, [open]);
  const show = (withFocus: boolean) => {
    focusFirst.current = withFocus;
    if (open) return;
    // Each time it opens, none of its own submenus is open.
    level.setOpen(null);
    parent.setOpen(id);
  };
  const hide = () => {
    parent.setOpen(null);
    trigger.current?.focus();
  };

  return (
    <div className="filetree-submenu-wrap" onMouseEnter={() => show(false)}>
      <button
        ref={trigger}
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        className={open ? "open" : undefined}
        // Pointing at it already opened it: a click keeps it open.
        onClick={() => show(false)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          if (open) ownItems(menu.current!)[0]?.focus();
          else show(true);
        }}
      >
        <props.icon size={15} className="menu-icon" aria-hidden />
        <span className="menu-label">{props.label}</span>
        <ChevronRight size={14} className="menu-more" aria-hidden />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={props.label}
          className="filetree-menu filetree-submenu"
          onKeyDown={(e) => onMenuKey(e, e.currentTarget, hide)}
        >
          <LevelContext.Provider value={level}>{props.children}</LevelContext.Provider>
        </div>
      )}
    </div>
  );
}
