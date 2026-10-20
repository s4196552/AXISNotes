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

  it("restores a dashboard tab with the vault's other tabs", () => {
    const s = deserialize(
      JSON.stringify({ tabs: [{ path: "School", view: "dashboard" }], active: 0 }),
    );
    expect(activeTab(s)).toMatchObject({ path: "School", view: "dashboard" });
    expect(JSON.parse(serialize(s)).tabs[0]).toEqual({ path: "School", view: "dashboard" });
  });
});
