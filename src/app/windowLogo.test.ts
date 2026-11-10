import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyWindowLogo } from "./windowLogo";
import { backend } from "../ipc";
vi.mock("../ipc", () => ({
  backend: { fileUrl: (path: string) => `asset://${path}`, setWindowIcon: vi.fn(async () => {}) },
}));
const images: FakeImage[] = [];
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 512;
  naturalHeight = 256;
  crossOrigin = "";
  src = "";
  constructor() {
    images.push(this);
  }
}
beforeEach(() => {
  images.length = 0;
  vi.clearAllMocks();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
it("converts the selected image to bounded RGBA pixels for the native icon", async () => {
  const close = applyWindowLogo("Attachments/logo.png", vi.fn());
  expect(images[0]!.src).toBe("asset://Attachments/logo.png");
  images[0]!.onload!();
  await vi.waitFor(() => expect(backend.setWindowIcon).toHaveBeenCalledOnce());
  expect(vi.mocked(backend.setWindowIcon).mock.calls[0]![0]).toHaveLength(256 * 256 * 4);
  close();
});
it("ignores a stale decode after the effect is disposed", async () => {
  const close = applyWindowLogo("Attachments/old.png", vi.fn());
  const load = images[0]!.onload!;
  close();
  load();
  await Promise.resolve();
  expect(backend.setWindowIcon).not.toHaveBeenCalled();
});
it("restores original pixels for a missing image and reports a native failure", async () => {
  const error = vi.fn();
  vi.mocked(backend.setWindowIcon).mockRejectedValueOnce(new Error("Native error"));
  const close = applyWindowLogo("Attachments/missing.png", error);
  images[0]!.onerror!();
  await vi.waitFor(() => expect(images).toHaveLength(2));
  expect(images[1]!.src).not.toContain("missing.png");
  images[1]!.onload!();
  await vi.waitFor(() =>
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Native error")),
  );
  close();
});
