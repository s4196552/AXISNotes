import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import { useConfig, mergeConfig } from "../../app/config";
import { Modals } from "./Modals";
import { useUi, type Modal } from "./ui";
vi.mock("../../app/lazy", () => ({ lazyNamed: () => () => <div>Source tool</div> }));
beforeEach(() => {
  useUi.getState().close();
  useConfig.setState({ config: mergeConfig({}) });
  useAppStore.setState({ vault: { root: "/v", name: "v" } });
});
const dialogs: Exclude<Modal, { kind: "prompt" }>[] = [
  { kind: "ask", path: "Old.md" },
  { kind: "fix", path: "Old.md", from: 0, to: 4, original: "text", scope: "note" },
  { kind: "handwriting", path: "Old.md" },
  { kind: "diagram", path: "Old.md" },
];
it.each(dialogs)("closes source-bound $kind UI when the vault changes", (modal) => {
  useUi.getState().open(modal);
  render(<Modals />);
  act(() => useAppStore.setState({ vault: { root: "/other", name: "other" } }));
  expect(useUi.getState().modal).toBeNull();
  act(() => useAppStore.setState({ vault: { root: "/v", name: "v" } }));
  expect(useUi.getState().modal).toBeNull();
});
