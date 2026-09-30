import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeatureBoundary } from "./FeatureBoundary";
function Broken(): never {
  throw new Error("Unavailable chunk");
}
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
it("keeps a recovery route and lets the owning surface dismiss a failed module", () => {
  const dismiss = vi.fn();
  render(
    <FeatureBoundary name="Graph" onDismiss={dismiss}>
      <Broken />
    </FeatureBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Your files and history are preserved");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Feature settings" })).toBeInTheDocument();
});
it("does not offer a dismiss button when the surface has no dismissal action", () => {
  render(
    <FeatureBoundary name="Time tracking">
      <Broken />
    </FeatureBoundary>,
  );
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  expect(screen.getByRole("button", { name: "Feature settings" })).toBeInTheDocument();
});
