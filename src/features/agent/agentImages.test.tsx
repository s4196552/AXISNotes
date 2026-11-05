import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "../../ipc";
import { AgentFigure } from "./AgentFigure";
import {
  clampFps,
  clampFrames,
  imageProblem,
  MAX_IMAGE_BYTES,
  type StoredImage,
} from "./agentImages";

// The storage is IndexedDB, which jsdom lacks: these tests replace it with a map.
const h = vi.hoisted(() => ({ store: new Map<string, unknown>(), version: 0 }));
vi.mock("./agentImages", async (orig) => {
  const mod = await orig<typeof import("./agentImages")>();
  const bump = () => mod.useAgentImagesVersion.setState({ version: ++h.version });
  return {
    ...mod,
    readImages: async () => Object.fromEntries(h.store),
    putImage: async (state: AgentState, img: StoredImage) => {
      h.store.set(state, img);
      bump();
    },
    deleteImage: async (state: AgentState) => {
      h.store.delete(state);
      bump();
    },
    clearImages: async () => {
      h.store.clear();
      bump();
    },
    loadAgentImages: async () => {
      const images: Record<string, unknown> = {};
      for (const [state, img] of h.store) {
        const s = img as StoredImage;
        images[state] = { url: `blob:${s.name}`, frames: s.frames, fps: s.fps };
      }
      mod.useAgentImageUrls.setState({ version: h.version, images });
    },
  };
});

describe("image checks", () => {
  it("accepts common image types up to 8 MB", () => {
    expect(imageProblem({ type: "image/gif", size: 10 })).toBeNull();
    expect(imageProblem({ type: "image/webp", size: MAX_IMAGE_BYTES })).toBeNull();
    expect(imageProblem({ type: "video/mp4", size: 10 })).toMatch(/PNG, JPG, GIF/);
    expect(imageProblem({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/over 8 MB/);
  });

  it("keeps frames and speed in range", () => {
    expect([clampFrames(0), clampFrames(8.4), clampFrames(500)]).toEqual([1, 8, 64]);
    expect([clampFps(Number.NaN), clampFps(12), clampFps(99)]).toEqual([1, 12, 30]);
  });
});

describe("AgentFigure with the user's images", () => {
  it("shows a single image, or steps through a sprite strip", () => {
    const { container, rerender } = render(
      <AgentFigure state="idle" size={96} image={{ url: "blob:one", frames: 1, fps: 8 }} />,
    );
    expect(container.querySelector("img.agent-image")).toHaveAttribute("src", "blob:one");
    rerender(
      <AgentFigure state="working" size={96} image={{ url: "blob:strip", frames: 6, fps: 12 }} />,
    );
    const sprite = container.querySelector<HTMLElement>(".agent-sprite")!;
    expect(sprite.style.backgroundImage).toBe('url("blob:strip")');
    expect(sprite.style.backgroundSize).toBe("600% 100%");
    expect(sprite.style.animationDuration).toBe("0.5s");
    expect(container.querySelector(".agent-bot")).toBeNull();
  });
});

describe("Settings → Agent images", () => {
  beforeEach(() => {
    h.store.clear();
    h.version = 0;
  });

  it("chooses an image for a state, sets sprite frames, and resets", async () => {
    const { AgentSettingsPanel } = await import("./AgentSettingsPanel");
    render(<AgentSettingsPanel />);
    const working = screen.getByRole("figure", { name: "Working image" });
    expect(within(working).getByText("Built-in")).toBeInTheDocument();

    fireEvent.click(within(working).getByRole("button", { name: /Choose/ }));
    const file = new File(["gif"], "run.gif", { type: "image/gif" });
    fireEvent.change(screen.getByLabelText("Agent image file"), { target: { files: [file] } });
    await waitFor(() => expect(within(working).getByText("run.gif")).toBeInTheDocument());
    expect((h.store.get("working") as StoredImage).frames).toBe(1);

    fireEvent.change(within(working).getByLabelText("Frames"), { target: { value: "4" } });
    await waitFor(() => expect((h.store.get("working") as StoredImage).frames).toBe(4));
    expect(within(working).getByLabelText(/Speed/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Agent image file"), {
      target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] },
    });
    // No slot was being picked, so nothing happens; picking a video shows the problem.
    fireEvent.click(within(working).getByRole("button", { name: /Change/ }));
    fireEvent.change(screen.getByLabelText("Agent image file"), {
      target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PNG, JPG, GIF/);

    fireEvent.click(screen.getByRole("button", { name: "Use the built-in Agent for every state" }));
    await waitFor(() => expect(within(working).getByText("Built-in")).toBeInTheDocument());
    expect(h.store.size).toBe(0);
  });
});
