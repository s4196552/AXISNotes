import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, mergeConfig, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { featureEnabled, DEFAULT_FEATURES } from "./catalog";
import { FeaturesSettings } from "./FeaturesSettings";
import { allCommands, commandForEvent } from "../commands/registry";
import { useTimer } from "../time/timer";
import { RightSidebar } from "../panels/Sidebars";
const h = vi.hoisted(() => ({ write: vi.fn(), timeEntries: vi.fn(), graph: vi.fn() }));
vi.mock("../../ipc", async (original) => ({
  ...(await original<typeof import("../../ipc")>()),
  backend: { writeFile: h.write, timeEntries: h.timeEntries, graph: h.graph },
}));
vi.mock("../daily/Calendar", () => ({ Calendar: () => null }));
vi.mock("../panels/BacklinksPanel", () => ({ BacklinksPanel: () => null }));
vi.mock("../graph/GraphView", () => ({ LocalGraph: () => <p>Loaded graph</p> }));
beforeEach(() => {
  h.write.mockReset().mockResolvedValue({ modifiedMs: 1 });
  h.timeEntries.mockReset();
  h.graph.mockReset();
  useConfig.setState({ config: mergeConfig({}), loaded: true });
  useTimer.getState().suspend();
  useAppStore.setState({
    activePath: "Note.md",
    vault: { root: "/v", name: "v" },
    mainView: "note",
  });
});
describe("bundled features", () => {
  it("migrates old config and preserves unknown settings while ignoring invalid feature flags", () => {
    const config = mergeConfig({
      features: { graph: false, aiAssist: "false", futureTool: { data: 42 } },
      spellcheck: { words: ["axis"] },
    });
    expect(config.features.graph).toBe(false);
    expect(config.features.aiAssist).toBe(true);
    expect(config.features).toHaveProperty("futureTool.data", 42);
    expect(config.spellcheck.words).toEqual(["axis"]);
    expect(mergeConfig({}).features).toEqual(DEFAULT_FEATURES);
  });
  it("hides dependent handwriting without changing its saved preference", () => {
    const flags = { ...DEFAULT_FEATURES, aiAssist: false };
    expect(featureEnabled(flags, "handwriting")).toBe(false);
    expect(flags.handwriting).toBe(true);
    expect(featureEnabled(flags, "diagrams")).toBe(true);
  });
  it("removes disabled commands and their keyboard shortcuts while retaining core commands", () => {
    useConfig.setState({
      config: mergeConfig({ features: { graph: false, aiAssist: false, timeTracking: false } }),
    });
    expect(allCommands().map((c) => c.id)).not.toEqual(
      expect.arrayContaining(["graph", "ask-ai", "stop-timer", "handwriting"]),
    );
    for (const id of ["graph", "ask-ai", "stop-timer", "handwriting"])
      expect(allCommands().some((c) => c.id === id)).toBe(false);
    expect(
      commandForEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true })),
    ).toBeUndefined();
    expect(allCommands().some((c) => c.id === "tasks")).toBe(true);
  });
  it("persists a disabled feature without changing privacy rules or dictionary data", async () => {
    useConfig.setState({
      config: mergeConfig({
        ai: { folders: { Medical: "never" } },
        spellcheck: { words: ["axis"] },
      }),
    });
    render(<FeaturesSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Graph views" }));
    await waitFor(() => expect(h.write).toHaveBeenCalled());
    const saved = JSON.parse(h.write.mock.calls[0]![1] as string);
    expect(saved.features.graph).toBe(false);
    expect(saved.ai.folders.Medical).toBe("never");
    expect(saved.spellcheck.words).toEqual(["axis"]);
  });
  it("rolls back a switch if its config cannot be saved", async () => {
    h.write.mockRejectedValue(new Error("Disk full"));
    render(<FeaturesSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Graph views" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
    expect(screen.getByRole("checkbox", { name: "Graph views" })).toBeChecked();
  });
  it("requires stopping a running timer before disabling its feature", async () => {
    useTimer.setState({ running: { path: "Note.md", start: "2026-09-30T01:00:00Z" } });
    render(<FeaturesSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Time tracking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stop the running timer");
    expect(h.write).not.toHaveBeenCalled();
    expect(useConfig.getState().config.features.timeTracking).toBe(true);
  });
  it("does not mount the local graph until requested, then removes it when disabled", async () => {
    render(<RightSidebar />);
    expect(screen.queryByText("Loaded graph")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show local graph" }));
    expect(await screen.findByText("Loaded graph")).toBeInTheDocument();
    act(() =>
      useConfig.setState({
        config: { ...DEFAULT_CONFIG, features: { ...DEFAULT_FEATURES, graph: false } },
      }),
    );
    expect(screen.queryByText("Loaded graph")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide local graph" })).toBeNull();
  });
  it("ignores timer restoration that completes after the feature is suspended", async () => {
    let resolve!: (v: unknown[]) => void;
    h.timeEntries.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const restoring = useTimer.getState().restore();
    useTimer.getState().suspend();
    resolve([{ path: "Note.md", start: "2026-09-30T01:00:00Z", end: null }]);
    await restoring;
    expect(useTimer.getState().running).toBeNull();
  });
});

it("waits for a timer write before allowing disable", async () => {
  useTimer.setState({ busy: true });
  render(<FeaturesSettings />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Time tracking" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("finish saving");
  expect(h.write).not.toHaveBeenCalled();
  useTimer.setState({ busy: false });
});
