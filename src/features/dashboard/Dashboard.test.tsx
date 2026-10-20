import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { CONFIG_PATH, DEFAULT_CONFIG, useConfig } from "../../app/config";
import { activeTab, deserialize, serialize } from "../../app/tabs";
import { formatDate } from "../../lib/dates";
import { FileTree } from "../filetree/FileTree";
import { Dashboard } from "./Dashboard";
import { dashboardFor } from "./dashboardModel";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const now = new Date();
const today = formatDate(now, "YYYY-MM-DD");
const yesterday = formatDate(
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  "YYYY-MM-DD",
);
const dailyPath = `Daily/${today}.md`;

async function setup(files: Record<string, string>) {
  h.b = createMemoryBackend(files);
  await h.b.openVault("/v");
  useAppStore.setState({ vault: { root: "/v", name: "Vault" }, tree: null, error: null });
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: false });
  await act(async () => {
    await useConfig.getState().load();
    await useAppStore.getState().refreshTree();
  });
}

const widget = (name: string) => screen.getByRole("region", { name });
const savedConfig = () => JSON.parse(h.b.files()[CONFIG_PATH] ?? "{}");

beforeEach(() => localStorage.clear());

describe("Dashboard", () => {
  it("shows today's tasks, the day schedule and ticks a task off in its note", async () => {
    await setup({
      "Work.md": `- [ ] 11:00 Review PR 📅 ${today}\n- [ ] Report 📅 ${yesterday} ⏫\n- [ ] Someday\n`,
      [dailyPath]: "# Today\n- 09:00 Standup\n- [ ] Buy milk\n",
      "School/Bio.md": "",
    });
    render(<Dashboard folder="" />);

    const tasks = widget("Today's tasks");
    await within(tasks).findByText("Report");
    expect(within(tasks).getByText("11:00 Review PR")).toBeInTheDocument();
    expect(within(tasks).getByText("Buy milk")).toBeInTheDocument();
    expect(within(tasks).queryByText("Someday")).toBeNull();

    const schedule = widget("Day schedule");
    await within(schedule).findByText("Standup");
    const rows = within(schedule)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows[0]).toContain("09:00");
    expect(rows[1]).toContain("Review PR");

    fireEvent.click(within(tasks).getByLabelText("Complete: Report"));
    await waitFor(() => expect(h.b.files()["Work.md"]).toContain(`- [x] Report 📅 ${yesterday}`));
  });

  it("shows task text with its Markdown styled and [[links]] that open the note", async () => {
    await setup({
      "Work.md": `- [ ] Read [[School/Bio|biology]] **first** 📅 ${today}\n`,
      "School/Bio.md": "# Bio\n",
    });
    render(<Dashboard folder="" />);
    const tasks = widget("Today's tasks");
    const link = await within(tasks).findByRole("button", { name: "biology" });
    expect(within(tasks).getByText("first").tagName).toBe("STRONG");
    expect(within(tasks).queryByText(/\[\[/)).toBeNull();
    // The checkbox is named by the text as read, without the Markdown.
    expect(within(tasks).getByLabelText("Complete: Read biology first")).toBeInTheDocument();

    fireEvent.click(link);
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("School/Bio.md"));
  });

  it("adds, reorders and removes widgets, and the layout survives a reload", async () => {
    await setup({ "A.md": "" });
    const { unmount } = render(<Dashboard folder="" />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(within(widget("Add a widget")).getByRole("button", { name: /Recent/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move Recent earlier" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Calendar" }));

    const order = ["tasks", "schedule", "recent", "links"];
    await waitFor(() =>
      expect(savedConfig().dashboards[""].widgets.map((w: { type: string }) => w.type)).toEqual(
        order,
      ),
    );
    unmount();

    // As after a restart: the config is read back from the vault.
    useConfig.setState({ config: DEFAULT_CONFIG, loaded: false });
    await act(() => useConfig.getState().load());
    expect(
      dashboardFor(useConfig.getState().config.dashboards, "")!.widgets.map((w) => w.type),
    ).toEqual(order);
    render(<Dashboard folder="" />);
    expect(screen.queryByRole("region", { name: "Calendar" })).toBeNull();
    expect(widget("Recent")).toBeInTheDocument();
  });

  it("pins a file to a links widget and opens it", async () => {
    await setup({ "School/Bio.md": "", "Ideas.md": "" });
    render(<Dashboard folder="" />);
    fireEvent.click(screen.getByRole("button", { name: "Pin a file or folder" }));
    fireEvent.click(await screen.findByRole("option", { name: /Ideas/ }));
    await waitFor(() =>
      expect(
        savedConfig().dashboards[""].widgets.find((w: { type: string }) => w.type === "links")
          .links,
      ).toEqual(["Ideas.md"]),
    );
    fireEvent.click(within(widget("Pinned")).getByTitle("Ideas.md"));
    expect(useAppStore.getState().activePath).toBe("Ideas.md");
  });

  it("adds a folder dashboard from the file tree, scoped to that folder", async () => {
    await setup({
      "School/Bio.md": `- [ ] Read chapter 📅 ${today}\n`,
      "Work.md": `- [ ] Report 📅 ${today}\n`,
    });
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "School" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add dashboard" }));
    await waitFor(() => expect(savedConfig().dashboards.School.enabled).toBe(true));
    const tab = activeTab(useAppStore.getState().tabs);
    expect(tab).toMatchObject({ view: "dashboard", path: "School" });
    // A dashboard's folder isn't a note.
    expect(useAppStore.getState().activePath).toBeNull();

    render(<Dashboard folder="School" />);
    const tasks = widget("Today's tasks");
    await within(tasks).findByText("Read chapter");
    expect(within(tasks).queryByText("Report")).toBeNull();

    // Removing it keeps the layout, switched off.
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("button", { name: /Remove dashboard/ }));
    await waitFor(() => expect(savedConfig().dashboards.School.enabled).toBe(false));
    expect(savedConfig().dashboards.School.widgets).toHaveLength(4);
    expect(await screen.findByRole("button", { name: "Add dashboard" })).toBeInTheDocument();
  });

  it("quick-adds a task and a timed item to today's note, creating it from the template", async () => {
    await setup({ "A.md": "" });
    render(<Dashboard folder="" />);

    const tasks = widget("Today's tasks");
    const input = await within(tasks).findByRole("textbox", { name: "Add a task" });
    fireEvent.change(input, { target: { value: "Buy milk" } });
    fireEvent.submit(input.closest("form")!);
    // The daily template's empty task is filled in.
    await waitFor(() => expect(h.b.files()[dailyPath]).toContain("## Tasks\n\n- [ ] Buy milk\n"));
    await within(tasks).findByText("Buy milk");
    expect(input).toHaveValue("");

    const schedule = widget("Day schedule");
    fireEvent.change(within(schedule).getByLabelText("Time"), { target: { value: "09:30" } });
    const what = within(schedule).getByRole("textbox", { name: "Add to schedule" });
    fireEvent.change(what, { target: { value: "Standup" } });
    fireEvent.submit(what.closest("form")!);
    await waitFor(() => expect(h.b.files()[dailyPath]).toContain("- 09:30 Standup\n"));
    await within(schedule).findByText("Standup");
  });

  it("looks a week ahead when asked, and remembers it", async () => {
    const soon = formatDate(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3),
      "YYYY-MM-DD",
    );
    await setup({ "Work.md": `- [ ] Essay 📅 ${soon}\n- [ ] Report 📅 ${today}\n` });
    render(<Dashboard folder="" />);
    const tasks = widget("Today's tasks");
    await within(tasks).findByText("Report");
    expect(within(tasks).queryByText("Essay")).toBeNull();

    fireEvent.click(within(tasks).getByRole("button", { name: "7 days" }));
    await within(tasks).findByText("Essay");
    expect(within(tasks).getByRole("heading", { name: "Next 7 days" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        savedConfig().dashboards[""].widgets.find((w: { type: string }) => w.type === "tasks")
          .options,
      ).toEqual({ range: "week" }),
    );
  });

  it("steps the schedule through days and marks task due dates on the calendar", async () => {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    await setup({
      [`Daily/${formatDate(tomorrow, "YYYY-MM-DD")}.md`]: "- 10:00 Dentist\n",
      "Work.md": `- [ ] Report 📅 ${today}\n- [ ] Plan 📅 ${today}\n`,
    });
    render(<Dashboard folder="" />);
    const schedule = widget("Day schedule");
    expect(within(schedule).getByRole("button", { name: "Today" })).toBeDisabled();
    fireEvent.click(within(schedule).getByRole("button", { name: "Next day" }));
    await within(schedule).findByText("Dentist");
    expect(within(schedule).getByText(formatDate(tomorrow, "dddd, MMMM D"))).toBeInTheDocument();
    fireEvent.click(within(schedule).getByRole("button", { name: "Today" }));
    await waitFor(() => expect(within(schedule).queryByText("Dentist")).toBeNull());

    const calendar = widget("Calendar");
    await within(calendar).findByRole("gridcell", { name: /, 2 tasks due$/ });
  });

  it("renames, resizes and drags widgets, and sets how many recent files show", async () => {
    await setup({ "A.md": "", "B.md": "" });
    render(<Dashboard folder="" />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    // Any widget can be renamed now, not only Pinned.
    const titles = screen.getAllByRole("textbox", { name: "Widget title" });
    fireEvent.change(titles[1]!, { target: { value: "Must do" } });
    fireEvent.blur(titles[1]!);
    await screen.findByRole("region", { name: "Must do" });

    fireEvent.click(screen.getByRole("button", { name: "Make Calendar wide" }));
    await waitFor(() => expect(widget("Calendar")).toHaveClass("wide"));

    // Drag the Pinned widget's handle onto the calendar: it lands before it.
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    const grip = within(widget("Pinned")).getByTitle("Drag to move");
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.dragOver(widget("Calendar"), { dataTransfer });
    expect(widget("Calendar")).toHaveClass("drop-before");
    fireEvent.drop(widget("Calendar"), { dataTransfer });
    fireEvent.dragEnd(grip, { dataTransfer });
    await waitFor(() =>
      expect(savedConfig().dashboards[""].widgets.map((w: { type: string }) => w.type)).toEqual([
        "links",
        "calendar",
        "tasks",
        "schedule",
      ]),
    );
    const saved = savedConfig().dashboards[""].widgets;
    expect(saved[1]).toMatchObject({ type: "calendar", size: "wide" });
    expect(saved[2]).toMatchObject({ type: "tasks", title: "Must do" });

    fireEvent.click(within(widget("Add a widget")).getByRole("button", { name: /Recent/ }));
    const show = await within(await screen.findByRole("region", { name: "Recent" })).findByRole(
      "combobox",
    );
    fireEvent.change(show, { target: { value: "4" } });
    await waitFor(() =>
      expect(
        savedConfig().dashboards[""].widgets.find((w: { type: string }) => w.type === "recent")
          .options,
      ).toEqual({ count: 4 }),
    );
  });

  it("reorders pinned cards with buttons and by dragging", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "" });
    useConfig.setState((s) => ({
      config: {
        ...s.config,
        dashboards: {
          "": {
            enabled: true,
            widgets: [{ id: "p", type: "links", links: ["A.md", "B.md", "C.md"] }],
          },
        },
      },
    }));
    render(<Dashboard folder="" />);
    const links = () => savedConfig().dashboards?.[""]?.widgets[0].links as string[] | undefined;
    // Outside Customize, cards don't move.
    expect(screen.queryByRole("button", { name: "Move C earlier" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(screen.getByRole("button", { name: "Move A earlier" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move C earlier" }));
    await waitFor(() => expect(links()).toEqual(["A.md", "C.md", "B.md"]));

    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    const card = (title: string) => screen.getByTitle(title).closest(".dashboard-card")!;
    fireEvent.dragStart(card("B.md"), { dataTransfer });
    fireEvent.dragOver(card("A.md"), { dataTransfer });
    fireEvent.drop(card("A.md"), { dataTransfer });
    await waitFor(() => expect(links()).toEqual(["B.md", "A.md", "C.md"]));
  });

  it("restores a dashboard tab with the vault's other tabs", () => {
    const s = deserialize(
      JSON.stringify({ tabs: [{ path: "School", view: "dashboard" }], active: 0 }),
    );
    expect(activeTab(s)).toMatchObject({ path: "School", view: "dashboard" });
    expect(JSON.parse(serialize(s)).tabs[0]).toEqual({ path: "School", view: "dashboard" });
  });
});
