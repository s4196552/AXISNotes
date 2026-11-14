import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHub, type HubBridge } from "./launcher.js";
import markup from "./launcher.html?raw";

// AXIS Hub's library as a bento grid: the first group's apps as large launch tiles, every
// other group as a tile of one-click app icons (T-244).

type Shortcut = {
  id: string;
  name: string;
  icon: string | null;
  target: { kind: string; url?: string };
};
type Group = { id: string; name: string; color: string; groups: Group[]; shortcuts: Shortcut[] };

let n = 0;
const app = (name: string): Shortcut => ({
  id: `s${n++}`,
  name,
  icon: null,
  target: { kind: "website", url: "https://example.com/" },
});
const group = (id: string, names: string[], groups: Group[] = []): Group => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  color: "blue",
  groups,
  shortcuts: names.map(app),
});

function library(groups: Group[]) {
  return {
    version: 1,
    plugins: [{ id: "launcher", name: "Launcher", description: "", enabled: true, groups }],
  };
}

let calls: [string, Record<string, unknown> | undefined][];
let root: ShadowRoot;
let dispose: () => void;

async function mount(groups: Group[]) {
  calls = [];
  let saved = library(groups);
  const bridge: HubBridge = {
    async invoke(command, args) {
      calls.push([command, args]);
      if (command === "load") return { library: structuredClone(saved), revision: "1" };
      if (command === "save") {
        saved = args!.library as typeof saved;
        return "2";
      }
      return null;
    },
    pick: async () => null,
    subscribe: () => () => {},
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = host.attachShadow({ mode: "open" });
  const template = document.createElement("template");
  template.innerHTML = markup;
  root.append(template.content);
  dispose = mountHub(root, bridge, "launcher");
  await vi.waitFor(() => expect(root.getElementById("content")!.ariaBusy).not.toBe("true"));
  await vi.waitFor(() => expect(root.querySelector(".loading-state")).toBeNull());
}

const $ = (selector: string) => root.querySelector<HTMLElement>(selector)!;
const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  n = 0;
  // The chosen sort is remembered on this device; start each test from the user's order.
  localStorage.removeItem("axis-hub-sort");
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

describe("AXIS Hub library", () => {
  it("leads with the first group's apps as large tiles and shows the rest as a grid", async () => {
    await mount([
      group("favorites", ["Email", "Chat", "Calls", "Calendar"]),
      group("work", ["Linear", "Jira"]),
      group("storage", ["Drive"]),
    ]);
    expect($$(".featured .launch-tile .shortcut-label").map((e) => e.textContent)).toEqual([
      "Email",
      "Chat",
      "Calls",
      "Calendar",
    ]);
    expect($(".featured .group-name").textContent).toBe("Favorites");
    expect($$(".bento > .bento-cell[data-hub-group]").map((e) => e.dataset.hubGroup)).toEqual([
      "work",
      "storage",
    ]);
    // One app alone is shown large; the grid ends with a tile for a new group.
    expect($('[data-hub-group="storage"]').classList.contains("solo")).toBe(true);
    expect($(".bento > .new-cell").textContent).toContain("New group");
  });

  it("keeps an empty first group in the grid rather than as an empty row", async () => {
    await mount([group("favorites", []), group("work", ["Linear"])]);
    expect($(".featured")).toBeNull();
    expect($$(".bento-cell[data-hub-group]").map((e) => e.dataset.hubGroup)).toEqual([
      "favorites",
      "work",
    ]);
    expect($('[data-hub-group="favorites"] .group-name').textContent).toBe("Favorites");
    expect($('[aria-label="Add a shortcut to Favorites"]')).not.toBeNull();
  });

  it("opens an app with one click from a group tile", async () => {
    await mount([group("favorites", []), group("work", ["Linear", "Jira"])]);
    $('[aria-label="Open Jira"]').click();
    await vi.waitFor(() =>
      expect(calls.filter(([c]) => c === "launch")).toEqual([["launch", { shortcutId: "s1" }]]),
    );
  });

  it("shows +N when a group has more than fit, and its groups as folder icons", async () => {
    const names = Array.from({ length: 10 }, (_, i) => `App ${i}`);
    await mount([
      group("favorites", []),
      group("projects", names),
      group("gaming", ["Spotify"], [group("shooters", ["VALORANT"])]),
    ]);
    const projects = $('[data-hub-group="projects"]');
    expect(projects.classList.contains("wide")).toBe(true);
    expect(projects.querySelectorAll("[data-hub-shortcut]")).toHaveLength(7);
    expect(projects.querySelector(".more-tile")!.textContent).toBe("+3");
    const folder = $('[data-hub-group="gaming"] .folder-tile');
    expect(folder.dataset.hubGroup).toBe("shooters");
    folder.click();
    await tick();
    expect($("#page-title").textContent).toBe("Shooters");
    expect($("#page-subtitle").textContent).toBe("Launcher / Gaming");
  });

  it("edits what is right-clicked", async () => {
    await mount([group("favorites", ["Email"]), group("work", ["Linear"])]);
    const rightClick = (element: Element) =>
      element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    rightClick($('[aria-label="Open Linear"]'));
    expect($("#dialog-title").textContent).toBe("Edit shortcut");
    ($("#dialog") as HTMLDialogElement).close();
    rightClick($('[data-hub-group="work"] .cell-icons'));
    expect($("#dialog-title").textContent).toBe("Edit group");
    ($("#dialog") as HTMLDialogElement).close();
    rightClick($('.featured [data-hub-shortcut="s0"]'));
    expect($("#dialog-title").textContent).toBe("Edit shortcut");
  });

  it("keeps the featured group fixed by the user's order and shows its folders", async () => {
    await mount([
      group("favorites", ["Email"], [group("travel", ["Maps"])]),
      group("apps", ["Linear"]),
    ]);
    const folder = $('.featured [data-hub-group="travel"]');
    expect(folder.textContent).toBe("Travel");
    // Sorting by name would put "Apps" first; the featured row stays Favorites.
    const sort = $("#sort") as HTMLSelectElement;
    sort.value = "name";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect($(".featured").dataset.hubGroup).toBe("favorites");
    $('.featured [data-hub-group="travel"]').click();
    await tick();
    expect($("#page-title").textContent).toBe("Travel");
  });

  it("shows an opened group's apps as large tiles with a menu", async () => {
    await mount([group("favorites", []), group("work", ["Linear", "Jira"])]);
    $('[data-hub-group="work"] .group-open').click();
    await tick();
    expect($("#page-title").textContent).toBe("Work");
    expect($$(".launch-grid .shortcut-label").map((e) => e.textContent)).toEqual([
      "Linear",
      "Jira",
    ]);
    expect($$('[aria-label="Edit Jira shortcut"]')).toHaveLength(1);
    expect($('[data-hub-shortcut="s1"] .hub-drag-grip')).not.toBeNull();
  });
});
