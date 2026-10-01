import { renderHook } from "@testing-library/react";
import { useVaultSpellcheck } from "./index";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mergeConfig, useConfig } from "../../app/config";
import { getSpeller, noSpeller, stopSpeller, retainSpeller } from "./engine";
import "./index";
const instances: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] =
  [];
beforeEach(() => {
  instances.length = 0;
  useConfig.setState({ config: mergeConfig({}) });
  vi.stubGlobal(
    "Worker",
    class {
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        instances.push(this);
      }
    },
  );
});
afterEach(() => {
  stopSpeller();
  vi.unstubAllGlobals();
});
it("starts only on use and terminates the worker with pending requests on disable", async () => {
  expect(instances).toHaveLength(0);
  const speller = getSpeller();
  expect(instances).toHaveLength(1);
  const pending = speller.check(["axis"]);
  const cancelled = expect(pending).rejects.toThrow("Spellcheck is disabled");
  useConfig.setState({ config: mergeConfig({ spellcheck: { enabled: false } }) });
  await cancelled;
  expect(instances[0]!.terminate).toHaveBeenCalledOnce();
  expect(getSpeller()).toBe(noSpeller);
  expect(instances).toHaveLength(1);
  useConfig.setState({ config: mergeConfig({ spellcheck: { enabled: true } }) });
  getSpeller();
  expect(instances).toHaveLength(2);
});

it("keeps a shared worker while another view uses it and releases it on the last close", () => {
  const closeFirst = retainSpeller(),
    closeSecond = retainSpeller();
  getSpeller();
  closeFirst();
  expect(instances[0]!.terminate).not.toHaveBeenCalled();
  closeSecond();
  expect(instances[0]!.terminate).toHaveBeenCalledOnce();
  closeSecond();
  const closeNext = retainSpeller();
  getSpeller();
  expect(instances).toHaveLength(2);
  closeNext();
});

it("retains the first-use worker across note navigation and releases it on vault close", () => {
  const owner = renderHook(() => useVaultSpellcheck("/vault", true));
  expect(instances).toHaveLength(0);
  const closeNote = retainSpeller();
  const worker = getSpeller();
  closeNote(); // New note loading creates a gap between editor consumers.
  expect(instances[0]!.terminate).not.toHaveBeenCalled();
  const closeNext = retainSpeller();
  expect(getSpeller()).toBe(worker);
  expect(instances).toHaveLength(1);
  closeNext();
  owner.unmount();
  expect(instances[0]!.terminate).toHaveBeenCalledOnce();
});
it("ends a vault lease immediately when spellcheck is disabled", () => {
  const owner = renderHook(({ enabled }) => useVaultSpellcheck("/vault", enabled), {
    initialProps: { enabled: true },
  });
  getSpeller();
  owner.rerender({ enabled: false });
  expect(instances[0]!.terminate).toHaveBeenCalledOnce();
  owner.unmount();
});
