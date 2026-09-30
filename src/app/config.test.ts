import { beforeEach, expect, it, vi } from "vitest";
import { mergeConfig, useConfig } from "./config";
import { useAppStore } from "./store";
const h = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../ipc", async (original) => ({
  ...(await original<typeof import("../ipc")>()),
  backend: { readFile: h.read },
}));
beforeEach(() => {
  h.read.mockReset();
  useConfig.setState({ config: mergeConfig({}), loaded: false, vaultRoot: null });
});
it("does not apply old vault settings after a later load finishes", async () => {
  let resolveOld!: (v: { content: string }) => void;
  h.read
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        }),
    )
    .mockResolvedValueOnce({
      content: JSON.stringify({ features: { graph: false, timeTracking: false } }),
    });
  useAppStore.setState({ vault: { root: "/old", name: "old" } });
  const old = useConfig.getState().load();
  useAppStore.setState({ vault: { root: "/new", name: "new" } });
  await useConfig.getState().load();
  resolveOld({ content: JSON.stringify({ features: { graph: true, timeTracking: true } }) });
  await old;
  expect(useConfig.getState().vaultRoot).toBe("/new");
  expect(useConfig.getState().config.features.graph).toBe(false);
  expect(useConfig.getState().config.features.timeTracking).toBe(false);
});
