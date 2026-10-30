import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend, type WindowFrame } from "../ipc";
import { isPanelOpen, toggleLeftPanel, useLayout } from "./layout";
import { setZen, toggleZen, useZenEdges, zenEdgeAt } from "./zen";

function frame(): WindowFrame {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    requestClose: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => {}),
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

  it("does nothing at the edges outside Zen mode", () => {
    render(<Edges />);
    move(2, 300);
    expect(useLayout.getState().zenReveal).toBeNull();
  });
});
