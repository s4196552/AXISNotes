import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { backend, type WindowFrame } from "../../ipc";
import { WindowControls } from "./WindowControls";

function fakeFrame(maximized = false) {
  let resized: (() => void) | undefined;
  const frame = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {
      maximized = !maximized;
      resized?.();
    }),
    requestClose: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => maximized),
    onResized: vi.fn(async (cb: () => void) => {
      resized = cb;
      return () => (resized = undefined);
    }),
  } satisfies WindowFrame;
  return frame;
}

afterEach(() => {
  backend.windowFrame = undefined;
});

describe("WindowControls", () => {
  it("shows nothing in a browser, which has its own frame", () => {
    const { container } = render(<WindowControls dragStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("minimizes, maximizes and restores, and asks to close", async () => {
    const frame = fakeFrame();
    backend.windowFrame = frame;
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(frame.minimize).toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Maximize" }));
    });
    expect(frame.toggleMaximize).toHaveBeenCalled();
    // The button follows the window's state after the resize.
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // A request, so the unsaved-work guard runs before the window goes.
    expect(frame.requestClose).toHaveBeenCalled();
  });

  it("adds a strip to drag the window by on screens without a tab row", () => {
    backend.windowFrame = fakeFrame();
    const { container } = render(<WindowControls dragStrip />);
    expect(container.querySelector(".titlebar-drag[data-tauri-drag-region]")).not.toBeNull();
  });

  it("stops listening for resizes when it goes", async () => {
    const frame = fakeFrame(true);
    backend.windowFrame = frame;
    const { unmount } = render(<WindowControls />);
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    unmount();
    await act(async () => frame.toggleMaximize());
    expect(frame.isMaximized).toHaveBeenCalledTimes(1);
  });
});
