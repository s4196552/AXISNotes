import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend, type WindowFrame } from "../ipc";
import { isPanelOpen, toggleLeftPanel, useLayout } from "./layout";
import { DRAG_START, isDragArea, setZen, toggleZen, useZenEdges, zenEdgeAt } from "./zen";

function frame(): WindowFrame {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    requestClose: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => {}),
    isFullscreen: vi.fn(async () => false),
    startDragging: vi.fn(async () => {}),
    onResized: vi.fn(async () => () => {}),
  };
}

function Edges() {
  useZenEdges();
  return <div className="sidebar-slot left" />;
}

const move = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
  });

afterEach(() => {
  setZen(false);
  backend.windowFrame = undefined;
  vi.useRealTimers();
});

describe("Zen mode", () => {
  it("finds the window edge under the pointer", () => {
    expect(zenEdgeAt(500, 2, 1000)).toBe("top");
    expect(zenEdgeAt(3, 400, 1000)).toBe("left");
    expect(zenEdgeAt(996, 400, 1000)).toBe("right");
    expect(zenEdgeAt(500, 400, 1000)).toBeNull();
  });

  it("goes full screen and back, hiding the panels until an edge reveals them", () => {
    const f = frame();
    backend.windowFrame = f;
    useLayout.setState({ left: true, right: true, compact: false });
    toggleZen();
    expect(f.setFullscreen).toHaveBeenLastCalledWith(true);
    expect(isPanelOpen(useLayout.getState(), "left")).toBe(false);
    // The panel buttons and shortcuts reveal a panel while in Zen mode.
    toggleLeftPanel();
    expect(isPanelOpen(useLayout.getState(), "left")).toBe(true);
    toggleZen();
    expect(f.setFullscreen).toHaveBeenLastCalledWith(false);
    // Out of Zen mode the docked panels are as they were.
    expect(isPanelOpen(useLayout.getState(), "left")).toBe(true);
    expect(useLayout.getState().zenReveal).toBeNull();
  });

  it("reveals a side at its edge and hides it once the pointer has left", () => {
    vi.useFakeTimers();
    backend.windowFrame = frame();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    render(<Edges />);
    act(() => setZen(true));
    move(2, 300);
    expect(useLayout.getState().zenReveal).toBe("left");
    move(500, 2);
    expect(useLayout.getState().zenReveal).toBe("top");
    move(998, 300);
    expect(useLayout.getState().zenReveal).toBe("right");
    // Away from the edge (and the revealed part): hidden after a moment, not at once.
    move(500, 400);
    expect(useLayout.getState().zenReveal).toBe("right");
    act(() => vi.advanceTimersByTime(400));
    expect(useLayout.getState().zenReveal).toBeNull();
  });

  it("keeps a panel that slid in under a pointer that stopped on it", () => {
    vi.useFakeTimers();
    backend.windowFrame = frame();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const { container } = render(<Edges />);
    const slot = container.querySelector(".sidebar-slot.left")!;
    const box = (right: number) =>
      ({ left: right - 260, right, top: 0, bottom: 800, width: 260, height: 800 }) as DOMRect;
    act(() => setZen(true));
    move(2, 300);
    // Mid-slide the panel is still mostly off-screen, so the pointer passing x = 200 is
    // outside it…
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(box(80));
    move(200, 300);
    // …but by the time the hide is due it has come to rest under the pointer.
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(box(260));
    act(() => vi.advanceTimersByTime(400));
    expect(useLayout.getState().zenReveal).toBe("left");
  });

  it("treats only title bar areas themselves as places to grab the window", () => {
    const area = document.createElement("div");
    area.setAttribute("data-tauri-drag-region", "");
    const tab = document.createElement("button");
    area.append(tab);
    expect(isDragArea(area)).toBe(true);
    expect(isDragArea(tab)).toBe(false);
    expect(isDragArea(document.createElement("div"))).toBe(false);
    expect(isDragArea(null)).toBe(false);
  });
});

describe("Zen mode's grab strip", () => {
  /** The shell's grab strip and a piece of the note, as App renders them in Zen mode. */
  function Strip() {
    useZenEdges();
    return (
      <>
        <div className="zen-drag-bar" data-tauri-drag-region />
        <p className="note">text</p>
      </>
    );
  }
  const press = (el: Element, init: MouseEventInit = {}) =>
    act(() => {
      el.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1, ...init }),
      );
    });
  const drag = (x: number, y: number) =>
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1 }));
    });
  const flush = () => act(async () => {});

  function setup(startFullscreen = true, maximized = false) {
    let fullscreen = false;
    const f = frame();
    const order: string[] = [];
    f.isFullscreen = vi.fn(async () => fullscreen);
    f.isMaximized = vi.fn(async () => maximized);
    f.setFullscreen = vi.fn(async (on: boolean) => {
      order.push(`fullscreen ${on}`);
      fullscreen = on;
    });
    f.toggleMaximize = vi.fn(async () => {
      order.push("maximize");
      maximized = !maximized;
    });
    f.startDragging = vi.fn(async () => void order.push("drag"));
    backend.windowFrame = f;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const { container } = render(<Strip />);
    act(() => setZen(true));
    // As the window is once Zen mode has made it full screen (or since it was snapped).
    fullscreen = startFullscreen;
    order.length = 0;
    return {
      f,
      order,
      strip: container.querySelector(".zen-drag-bar")!,
      note: container.querySelector(".note")!,
    };
  }

  it("moves a full screen window as a maximized one, so Windows can snap it", async () => {
    const { f, order, strip } = setup();
    move(500, 2);
    press(strip, { clientX: 500, clientY: 3 });
    // A press alone doesn't move the window or leave full screen…
    drag(501, 4);
    await flush();
    expect(f.startDragging).not.toHaveBeenCalled();
    // …moving it a few pixels does.
    drag(500 + DRAG_START, 3);
    await flush();
    expect(order).toEqual(["fullscreen false", "maximize", "drag"]);
    // Still Zen mode, so the window stays without its bars.
    expect(useLayout.getState().zen).toBe(true);
  });

  it("drags a window that is no longer full screen (snapped) directly", async () => {
    const { order, strip } = setup(false);
    move(500, 2);
    press(strip, { clientX: 500, clientY: 3 });
    drag(520, 3);
    await flush();
    expect(order).toEqual(["drag"]);
  });

  it("hides the bar after the drop and keeps the edge it lands on from revealing", async () => {
    vi.useFakeTimers();
    const { strip } = setup();
    move(500, 2);
    expect(useLayout.getState().zenReveal).toBe("top");
    press(strip, { clientX: 500, clientY: 3 });
    drag(520, 3);
    await flush();
    // Snapped to the left half: the pointer is now on the window's left edge.
    move(1, 300);
    expect(useLayout.getState().zenReveal).toBeNull();
    move(500, 1);
    expect(useLayout.getState().zenReveal).toBeNull();
    // Once it has left the edges, they reveal as before.
    move(500, 400);
    move(500, 2);
    expect(useLayout.getState().zenReveal).toBe("top");
  });

  it("restores on double-click, as a title bar does, and maximizes again", async () => {
    const { order, strip } = setup(true, true);
    press(strip, { detail: 2 });
    await flush();
    // Full screen over a maximized window comes back to the window's own size.
    expect(order).toEqual(["fullscreen false", "maximize"]);
    order.length = 0;
    press(strip, { detail: 2 });
    await flush();
    expect(order).toEqual(["maximize"]);
  });

  it("leaves presses on the note alone and stops Tauri's own drag on the strip", async () => {
    const { f, note, strip } = setup();
    const tauri = vi.fn();
    document.addEventListener("mousedown", tauri);
    try {
      press(note, { clientX: 500, clientY: 3 });
      drag(540, 3);
      await flush();
      expect(f.startDragging).not.toHaveBeenCalled();
      expect(tauri).toHaveBeenCalledTimes(1);
      press(strip);
      expect(tauri).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("mousedown", tauri);
    }
  });

  it("does nothing at the edges outside Zen mode", () => {
    render(<Edges />);
    move(2, 300);
    expect(useLayout.getState().zenReveal).toBeNull();
  });
});
