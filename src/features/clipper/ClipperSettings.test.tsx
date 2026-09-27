import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { ClipperSettings } from "./ClipperSettings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(() => {
  h.b = createMemoryBackend({});
});

describe("Settings → Web clipper", () => {
  it("shows the endpoint state and opens the bundled extension folder", async () => {
    render(<ClipperSettings />);
    expect(await screen.findByRole("status")).toHaveTextContent("runs in the desktop app");
    // Pairing needs the endpoint running.
    expect(screen.getByRole("button", { name: "Pair a browser" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open extension folder" }));
    expect(await screen.findByText("/app/extension")).toBeInTheDocument();
  });

  it("shows the pairing code while the endpoint runs", async () => {
    h.b.clipperStatus = async () => ({
      enabled: true,
      running: true,
      port: 38417,
      folder: "Clippings",
      error: null,
      devices: [],
    });
    render(<ClipperSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Pair a browser" }));
    expect(await screen.findByLabelText("Code")).toHaveTextContent("000000");
    expect(screen.getByText(/Expires in 5:00/)).toBeInTheDocument();
  });
});
