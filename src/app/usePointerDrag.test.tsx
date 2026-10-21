import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePointerDrag } from "./usePointerDrag";

/** Two items; dragging one over the other targets it. */
function Items({
  onDrop,
  onClick,
}: {
  onDrop(item: string, target: string): void;
  onClick(): void;
}) {
  const { press, dragging, target } = usePointerDrag<string, string>(
    (x) => (x > 100 ? "B" : null),
    onDrop,
  );
  return (
    <>
      <button onPointerDown={(e) => press(e, "A")} onClick={onClick}>
        A
      </button>
      <p role="status">{dragging ? `${dragging} → ${target ?? "nothing"}` : "idle"}</p>
    </>
  );
}

const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("usePointerDrag", () => {
  it("drags past a few pixels and drops on the target, without the ending click", async () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Items onDrop={onDrop} onClick={onClick} />);
    fireEvent.pointerDown(screen.getByText("A"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 3, clientY: 0 }); // not yet a drag
    expect(screen.getByRole("status")).toHaveTextContent("idle");
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    expect(screen.getByRole("status")).toHaveTextContent("A → nothing");
    expect(document.body).toHaveClass("pointer-dragging");
    fireEvent.pointerMove(window, { clientX: 150, clientY: 0 });
    expect(screen.getByRole("status")).toHaveTextContent("A → B");
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByText("A"));
    expect(onDrop).toHaveBeenCalledWith("A", "B");
    expect(onClick).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass("pointer-dragging");
    await tick();
    fireEvent.click(screen.getByText("A"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("leaves a short press a click, and Escape cancels a drag", async () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Items onDrop={onDrop} onClick={onClick} />);
    fireEvent.pointerDown(screen.getByText("A"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByText("A"));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(screen.getByText("A"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 0 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("status")).toHaveTextContent("idle");
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();
    await tick();
    // Right-button and modified presses never drag.
    fireEvent.pointerDown(screen.getByText("A"), { button: 0, ctrlKey: true, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 0 });
    expect(screen.getByRole("status")).toHaveTextContent("idle");
  });
});
