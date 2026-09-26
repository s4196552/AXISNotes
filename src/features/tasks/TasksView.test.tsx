import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { formatDate } from "../../lib/dates";
import { bucketOf, matchesFilter } from "./taskModel";
import { TasksView } from "./TasksView";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return formatDate(d, "YYYY-MM-DD");
};
const today = day(0);

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Work.md": `# Work\n- [ ] Report 📅 ${day(-2)} ⏫\n- [ ] Standup 📅 ${today}\n- [x] Old thing\n`,
    "Home/Chores.md": `- [ ] Laundry #home\n- [ ] Taxes 📅 ${day(30)}\n- [ ] Plants 📅 ${day(3)} 🔽\n`,
  });
  await h.b.openVault("/v");
  useAppStore.setState({ error: null, notice: null, mainView: "tasks", activePath: null });
});

const group = (name: string) => screen.getByRole("region", { name });

describe("TasksView", () => {
  it("groups open tasks by due date and hides done ones by default", async () => {
    render(<TasksView />);
    await screen.findByText("Report");
    expect(within(group("Overdue")).getByText("Report")).toBeInTheDocument();
    expect(within(group("Overdue")).getByLabelText("High priority")).toBeInTheDocument();
    expect(within(group("Today")).getByText("Standup")).toBeInTheDocument();
    expect(within(group("Next 7 days")).getByText("Plants")).toBeInTheDocument();
    expect(within(group("Later")).getByText("Taxes")).toBeInTheDocument();
    expect(within(group("No date")).getByText("Laundry #home")).toBeInTheDocument();
    expect(screen.queryByText("Old thing")).toBeNull();
    expect(screen.getByText("5 open")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show done"));
    expect(within(group("Done")).getByText("Old thing")).toBeInTheDocument();
  });

  it("completes a task by editing its note, then reopens it", async () => {
    render(<TasksView />);
    fireEvent.click(await screen.findByLabelText("Complete: Standup"));
    await waitFor(() =>
      expect(h.b.files()["Work.md"]).toContain(`- [x] Standup 📅 ${today} ✅ ${today}`),
    );
    fireEvent.click(screen.getByLabelText("Show done"));
    fireEvent.click(await screen.findByLabelText("Reopen: Standup"));
    await waitFor(() => expect(h.b.files()["Work.md"]).toContain(`- [ ] Standup 📅 ${today}\n`));
  });

  it("doesn't edit a line that changed since the list was loaded", async () => {
    render(<TasksView />);
    await screen.findByText("Laundry #home");
    await h.b.writeFile("Home/Chores.md", "- [ ] Laundry (moved)\n");
    fireEvent.click(screen.getByLabelText("Complete: Laundry #home"));
    await waitFor(() => expect(useAppStore.getState().notice).toMatch(/changed/));
    expect(h.b.files()["Home/Chores.md"]).toBe("- [ ] Laundry (moved)\n");
    expect(await screen.findByText("Laundry (moved)")).toBeInTheDocument();
  });

  it("filters and opens the note at the task's line", async () => {
    render(<TasksView />);
    await screen.findByText("Report");
    fireEvent.change(screen.getByLabelText("Filter tasks"), { target: { value: "tag:home" } });
    expect(screen.queryByText("Report")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chores" }));
    expect(useAppStore.getState()).toMatchObject({
      activePath: "Home/Chores.md",
      mainView: "note",
      pendingTarget: { path: "Home/Chores.md", line: 1 },
    });
  });

  it("buckets and filters by rule", () => {
    expect(bucketOf({ done: false, due: day(7) }, today)).toBe("week");
    expect(bucketOf({ done: false, due: day(8) }, today)).toBe("later");
    const t = {
      path: "A/B.md",
      line: 1,
      raw: "",
      text: "x #work/alpha",
      done: false,
      due: null,
      priority: 0,
    };
    expect(matchesFilter(t, "tag:work")).toBe(true);
    expect(matchesFilter(t, "tag:wor")).toBe(false);
    expect(matchesFilter(t, "path:a/ x")).toBe(true);
  });
});
