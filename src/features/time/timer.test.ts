import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { mergeConfig, useConfig } from "../../app/config";
import { splitFrontmatter } from "../../lib/markdown";
import { useTimer } from "./timer";
const h = vi.hoisted(() => ({ backend: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (original) => ({
  ...(await original<typeof import("../../ipc")>()),
  backend: new Proxy({}, { get: (_target, key) => h.backend[key as keyof MemoryBackend] }),
}));
const start = "2026-09-30T01:00:00";
const log = (file: string) =>
  splitFrontmatter(h.backend.files()[file]!).props.time_log as
    { start: string; end?: string }[] | undefined;
beforeEach(async () => {
  h.backend = createMemoryBackend({
    "Old.md": "---\ntime_log:\n  - start: " + start + "\n---\n# Old\n",
    "New.md": "# New\n",
  });
  await h.backend.openVault("/v");
  useConfig.setState({ config: mergeConfig({}) });
  useTimer.getState().suspend();
  useTimer.setState({ busy: false });
  useAppStore.setState({ vault: { root: "/v", name: "v" }, error: null, notice: null });
});
async function delayedRestore() {
  const entries = await h.backend.timeEntries();
  let resolve!: (value: typeof entries) => void;
  vi.spyOn(h.backend, "timeEntries").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  return { entries, resolve: () => resolve(entries) };
}
it("waits for an old timer to restore and closes it before starting a second one", async () => {
  const delayed = await delayedRestore();
  const restoring = useTimer.getState().restore();
  const starting = useTimer.getState().start("New.md");
  expect(log("New.md")).toBeUndefined();
  delayed.resolve();
  await Promise.all([restoring, starting]);
  expect(log("Old.md")?.[0]?.end).toBeDefined();
  expect(log("New.md")).toHaveLength(1);
  expect(useTimer.getState().running?.path).toBe("New.md");
});
it("does not discard restoration when stop is called with no in-memory timer", async () => {
  const delayed = await delayedRestore();
  const restoring = useTimer.getState().restore();
  await useTimer.getState().stop();
  delayed.resolve();
  await restoring;
  expect(useTimer.getState().running).toMatchObject({ path: "Old.md", start });
  expect(log("Old.md")?.[0]?.end).toBeUndefined();
});
it("does not write a second timer when restoring persisted state fails", async () => {
  const original = { ...h.backend.files() };
  vi.spyOn(h.backend, "timeEntries").mockRejectedValue(new Error("Index unavailable"));
  await useTimer.getState().start("New.md");
  expect(useTimer.getState().restoreStatus).toBe("failed");
  expect(h.backend.files()).toEqual(original);
  expect(useTimer.getState().running).toBeNull();
});
it("does not start in another vault after a delayed restore from the previous vault", async () => {
  const original = { ...h.backend.files() };
  const delayed = await delayedRestore();
  const starting = useTimer.getState().start("New.md");
  useAppStore.setState({ vault: { root: "/other", name: "other" } });
  useTimer.getState().suspend();
  delayed.resolve();
  await starting;
  expect(h.backend.files()).toEqual(original);
  expect(useTimer.getState().running).toBeNull();
});
