import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { splitFrontmatter } from "../../lib/markdown";
import { useTimer } from "./timer";
import { TimeReport } from "./TimeReport";
import { RunningTimer } from "./TimerControls";
import { stamp } from "./timeLog";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const today = stamp(new Date()).slice(0, 10);
const log = (path: string) =>
  splitFrontmatter(h.b.files()[path]!).props.time_log as {
    start: string;
    end?: string;
    task?: string;
  }[];

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Work/Report.md": `---\ntags: [work]\ntime_log:\n  - start: ${today}T09:00:00\n    end: ${today}T10:30:00\n---\n- [ ] Draft\n`,
    "Home.md": "# Home\n",
  });
  await h.b.openVault("/v");
  useTimer.setState({ running: null });
  useAppStore.setState({
    error: null,
    notice: null,
    activePath: null,
    notes: [
      { path: "Work/Report.md", name: "Report", title: null, aliases: [] },
      { path: "Home.md", name: "Home", title: null, aliases: [] },
    ],
  });
});

describe("time tracking", () => {
  it("starts, restores and stops a timer stored in the note's time_log", async () => {
    await act(() => useTimer.getState().start("Home.md", "Tidy"));
    expect(log("Home.md")).toEqual([{ start: useTimer.getState().running!.start, task: "Tidy" }]);

    // A restart finds the open entry again.
    useTimer.setState({ running: null });
    await act(() => useTimer.getState().restore());
    expect(useTimer.getState().running).toMatchObject({ path: "Home.md", task: "Tidy" });

    render(<RunningTimer />);
    expect(screen.getByRole("timer")).toHaveTextContent("Home · Tidy");
    // Starting another timer stops the first one.
    await act(() => useTimer.getState().start("Work/Report.md"));
    expect(log("Home.md")[0]!.end).toBeDefined();
    expect(log("Work/Report.md").at(-1)!.end).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    await waitFor(() => expect(log("Work/Report.md").at(-1)!.end).toBeDefined());
    expect(useTimer.getState().running).toBeNull();
  });

  it("reports totals and logs time by hand", async () => {
    render(<TimeReport />);
    expect(await screen.findByRole("rowheader", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByLabelText("Total time")).toHaveTextContent("1h 30m");

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "tag" } });
    expect(screen.getByRole("rowheader", { name: "#work" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Home.md" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Task (optional)"), { target: { value: "Plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    await waitFor(() =>
      expect(log("Home.md")).toEqual([
        { start: `${today}T13:00:00`, end: `${today}T13:45:00`, task: "Plan" },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText("Total time")).toHaveTextContent("2h 15m"));
  });
});
