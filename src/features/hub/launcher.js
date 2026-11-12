export function mountHub(root, bridge, mode) {
  const $ = (id) => root.getElementById(id);
  const dialog = $("dialog");
  const dialogBody = $("dialog-body");
  const { invoke, pick, subscribe } = bridge;
  const colors = {
    mint: "#53a889",
    blue: "#628bbd",
    violet: "#9b7bc3",
    amber: "#bf9a65",
    rose: "#bd7894",
    slate: "#8095a4",
  };
  const kinds = { path: "File or folder", "windows-app": "Windows app", website: "Website" };
  const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  let library;
  let revision;
  let route = { kind: mode === "settings" ? "plugins" : "home" };
  let disposed = false;
  let pendingRefresh = false;
  let refreshGeneration = 0;
  let saving = false;
  let modalVersion = 0;
  let appDiscovery;
  let noticeTimer;

  function el(tag, className = "", text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function button(label, action, className = "button") {
    const control = el("button", className, label);
    control.type = "button";
    control.addEventListener("click", async () => {
      try {
        await action();
      } catch (error) {
        showError(error);
      }
    });
    return control;
  }

  function field(label, control, hint) {
    const field = el("label", "form-field");
    field.append(el("span", "field-label", label), control);
    if (hint) field.append(el("small", "field-hint", hint));
    return field;
  }

  function input(value = "", placeholder = "", maxLength = 100) {
    const control = el("input");
    control.value = value;
    control.placeholder = placeholder;
    control.maxLength = maxLength;
    return control;
  }

  function select(options, current) {
    const control = el("select");
    for (const [value, label] of options) {
      const option = el("option", "", label);
      option.value = value;
      control.append(option);
    }
    if (current != null) control.value = current;
    return control;
  }

  function notice(message, error = false) {
    if (disposed) return;
    clearTimeout(noticeTimer);
    const node = $("notice");
    node.textContent = message;
    node.dataset.error = String(error);
    node.hidden = false;
    noticeTimer = setTimeout(
      () => {
        node.hidden = true;
      },
      error ? 10000 : 4200,
    );
  }

  function showError(error) {
    if (disposed) return;
    const message = error?.message ?? String(error);
    const inline = dialog.open && dialogBody.querySelector(".dialog-error");
    if (inline) {
      inline.textContent = message;
      inline.hidden = false;
    } else notice(message, true);
  }

  function showDialog(title) {
    modalVersion += 1;
    const body = el("div", "form-fields");
    const error = el("p", "dialog-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    $("dialog-title").textContent = title;
    dialogBody.replaceChildren(error, body);
    if (!dialog.open) dialog.showModal();
    return body;
  }

  function formActions(body, label, submit, extras = []) {
    const form = el("form", "form-fields");
    form.append(...body.children);
    const actions = el("div", "dialog-actions");
    const save = el("button", "button primary", label);
    save.type = "submit";
    actions.append(
      ...extras,
      button("Cancel", () => dialog.close()),
      save,
    );
    form.append(actions);
    body.append(form);
    let submitting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || submitting || save.disabled) return;
      submitting = true;
      save.disabled = true;
      const error = dialogBody.querySelector(".dialog-error");
      error.hidden = true;
      try {
        await submit();
      } catch (error) {
        showError(error);
      } finally {
        submitting = false;
        save.disabled = false;
      }
    });
    form.querySelector("input:not([type=hidden]):not([type=file]), select")?.focus();
    return save;
  }

  function enabled(data = library) {
    return data.plugins.filter((plugin) => plugin.enabled);
  }

  function groups(data = library) {
    const result = [];
    function add(children, plugin, parents) {
      for (const group of children) {
        result.push({ group, plugin, parents, siblings: children });
        add(group.groups, plugin, [...parents, group]);
      }
    }
    for (const plugin of enabled(data)) add(plugin.groups, plugin, []);
    return result;
  }

  function groupById(id, data = library) {
    return groups(data).find(({ group }) => group.id === id);
  }

  function navigate(next) {
    route = next;
    $("search").value = "";
    $("main").scrollTop = 0;
    render();
  }

  async function commit(edit, message, next) {
    if (saving) throw new Error("A library change is being saved. Try again in a moment.");
    const candidate = structuredClone(library);
    edit(candidate);
    const version = modalVersion;
    saving = true;
    try {
      revision = await invoke("save", { library: candidate, revision });
      if (disposed) return;
      library = candidate;
      if (dialog.open && version === modalVersion) dialog.close();
      if (next) navigate(next);
      else render();
      if (message) notice(message);
    } catch (error) {
      pendingRefresh = true;
      throw error;
    } finally {
      saving = false;
      if (pendingRefresh) void refresh();
    }
  }

  function ordered(entries, shortcuts = false) {
    const mode = $("sort").value;
    if (mode === "manual") return entries;
    return entries.toSorted((a, b) => {
      const type =
        shortcuts && mode === "type"
          ? byName.compare(kinds[a.target.kind], kinds[b.target.kind])
          : 0;
      return type || byName.compare(a.name, b.name);
    });
  }

  function render() {
    if (disposed || !library) return;
    const home = $("nav-home");
    const plugins = $("plugins-button");
    if (route.kind === "plugins") {
      home.removeAttribute("aria-current");
      plugins.setAttribute("aria-current", "page");
    } else {
      home.setAttribute("aria-current", "page");
      plugins.removeAttribute("aria-current");
    }
    renderContent();
  }

  async function refresh() {
    if (disposed || !library) return;
    if (dialog.open || saving) {
      pendingRefresh = true;
      return;
    }
    pendingRefresh = false;
    const previousRevision = revision;
    const generation = ++refreshGeneration;
    try {
      const snapshot = await invoke("load");
      if (disposed || generation !== refreshGeneration) return;
      if (dialog.open || saving || previousRevision !== revision) {
        pendingRefresh = true;
        return;
      }
      ({ library, revision } = snapshot);
      if (route.kind === "group" && !groupById(route.id)) route = { kind: "home" };
      if (route.kind === "plugin" && !enabled().some(({ id }) => id === route.id)) {
        route = { kind: "home" };
      }
      render();
    } catch (error) {
      showError(error);
    }
  }

  function iconFor(shortcut) {
    const iconText = el(
      "span",
      "app-icon fallback-icon",
      [...shortcut.name.trim()][0]?.toLocaleUpperCase() || "?",
    );
    iconText.setAttribute("aria-hidden", "true");
    if (shortcut.icon) {
      const icon = el("img", "app-icon");
      icon.alt = "";
      icon.src = shortcut.icon;
      icon.addEventListener("error", () => icon.replaceWith(iconText), { once: true });
      return icon;
    }
    return iconText;
  }

  function colorFor(shortcut) {
    const palette = Object.values(colors);
    const hash = [...shortcut.name].reduce(
      (value, letter) => (value * 31 + letter.charCodeAt(0)) | 0,
      0,
    );
    return palette[Math.abs(hash) % palette.length];
  }

  async function launch(shortcut) {
    await invoke("launch", { shortcutId: shortcut.id });
    notice(`Opened ${shortcut.name}`);
  }

  function tile(shortcut, mini = false) {
    const className = mini ? "app-tile mini-tile" : "app-tile";
    if (!shortcut) return el("span", `${className} tile-placeholder`);
    const control = button("", () => launch(shortcut), className);
    control.title = shortcut.name;
    control.setAttribute("aria-label", `Open ${shortcut.name}`);
    control.style.setProperty("--tile-tint", colorFor(shortcut));
    control.append(iconFor(shortcut));
    return control;
  }

  function iconButton(glyph, label, action) {
    const control = button(glyph, action, "button icon-button");
    control.setAttribute("aria-label", label);
    control.title = label;
    return control;
  }

  function groupCard(group) {
    const card = el("article", "group-card");
    card.style.setProperty("--group-tint", colors[group.color]);
    const mosaic = el("div", "group-mosaic");
    const shortcuts = ordered(group.shortcuts, true);
    for (let index = 0; index < 3; index += 1) mosaic.append(tile(shortcuts[index]));
    const mini = el("div", "mini-grid");
    for (let index = 3; index < 7; index += 1) mini.append(tile(shortcuts[index], true));
    mosaic.append(mini);
    const footer = el("div", "group-footer");
    const open = button("", () => navigate({ kind: "group", id: group.id }), "group-open");
    const count = group.shortcuts.length;
    const detail = `${count} ${count === 1 ? "shortcut" : "shortcuts"}${group.groups.length ? ` · ${group.groups.length} ${group.groups.length === 1 ? "group" : "groups"}` : ""}`;
    open.append(el("span", "group-name", group.name), el("span", "group-meta", detail));
    footer.append(
      open,
      iconButton("···", `Edit ${group.name} group`, () => groupDialog(group.id)),
    );
    card.append(mosaic, footer);
    return card;
  }

  function shortcutCard(shortcut, group) {
    const card = el("article", "shortcut-card");
    const open = button("", () => launch(shortcut), "shortcut-launch");
    open.title = `Open ${shortcut.name}`;
    open.style.setProperty("--tile-tint", colorFor(shortcut));
    open.append(
      iconFor(shortcut),
      el("span", "shortcut-label", shortcut.name),
      el("span", "shortcut-meta", kinds[shortcut.target.kind]),
    );
    const actions = el("div", "shortcut-actions");
    actions.append(
      iconButton("···", `Edit ${shortcut.name} shortcut`, () => shortcutDialog(group.id, shortcut)),
    );
    card.append(open, actions);
    return card;
  }

  function grid(className, entries) {
    const container = el("div", className);
    container.append(...entries);
    return container;
  }

  function emptyState(title, detail, actions = []) {
    const panel = el("div", "empty-state");
    const icon = el("span", "empty-icon", "▦");
    icon.setAttribute("aria-hidden", "true");
    panel.append(icon, el("h2", "", title), el("p", "", detail));
    if (actions.length) panel.append(grid("empty-actions", actions));
    return panel;
  }

  function page(title, detail, plugins = false) {
    $("page-title").textContent = title;
    $("page-subtitle").textContent = detail;
    $("page-subtitle").hidden = !detail;
    $("view-controls").hidden = plugins;
    root.querySelector(".page-actions").hidden = plugins;
  }

  function renderContent() {
    const content = $("content");
    content.replaceChildren();
    const activeGroup = route.kind === "group" && groupById(route.id);
    const plugin = route.kind === "plugin" && enabled().find(({ id }) => id === route.id);
    if (route.kind === "plugins") {
      page("Shortcut packs", "", true);
      const section = el("section", "settings-section");
      section.setAttribute("aria-labelledby", "plugins-heading");
      const heading = el("h2", "settings-section-heading", "AXIS Hub plugins");
      heading.id = "plugins-heading";
      section.append(
        heading,
        el(
          "p",
          "settings-description",
          "Add shortcut packs and choose which ones appear in your library.",
        ),
        renderPlugins(),
      );
      content.append(section);
      return;
    }
    if (activeGroup)
      page(
        activeGroup.group.name,
        [activeGroup.plugin.name, ...activeGroup.parents.map(({ name }) => name)].join(" / "),
      );
    else if (plugin) page(plugin.name, plugin.description || "Shortcut groups");
    else page("Library", "Open your apps, files, folders and websites from one place.");

    const search = $("search").value.trim().toLocaleLowerCase();
    if (search) {
      const groupMatches = groups().filter(({ group }) =>
        group.name.toLocaleLowerCase().includes(search),
      );
      const items = groups().flatMap(({ group }) =>
        group.shortcuts.map((shortcut) => ({ group, shortcut })),
      );
      const found = items.filter(({ shortcut }) =>
        `${shortcut.name} ${targetValue(shortcut.target)}`.toLocaleLowerCase().includes(search),
      );
      if (groupMatches.length)
        content.append(
          grid(
            "group-grid",
            groupMatches.map(({ group }) => groupCard(group)),
          ),
        );
      if (found.length) {
        const results = new Map(found.map(({ group, shortcut }) => [shortcut.id, group]));
        content.append(
          grid(
            "shortcut-grid",
            ordered(
              found.map(({ shortcut }) => shortcut),
              true,
            ).map((shortcut) => shortcutCard(shortcut, results.get(shortcut.id))),
          ),
        );
      }
      if (!groupMatches.length && !found.length)
        content.append(emptyState("No matches", "Try another name or filepath."));
      return;
    }

    if (activeGroup) {
      const { group, parents } = activeGroup;
      const parent = parents.at(-1);
      const back = parent
        ? { kind: "group", id: parent.id }
        : { kind: "plugin", id: activeGroup.plugin.id };
      content.append(
        grid("section-actions", [
          button(`‹ ${parent?.name || activeGroup.plugin.name}`, () => navigate(back)),
          button("Edit group", () => groupDialog(group.id)),
        ]),
      );
      if (group.shortcuts.length)
        content.append(
          grid(
            "shortcut-grid",
            ordered(group.shortcuts, true).map((item) => shortcutCard(item, group)),
          ),
        );
      if (group.groups.length)
        content.append(grid("group-grid", ordered(group.groups).map(groupCard)));
      if (!group.groups.length && !group.shortcuts.length) {
        content.append(
          emptyState(
            "Add your first shortcut",
            "Pin an installed app, a local path or a website.",
            [
              button("Find installed apps", () => appsDialog(group.id), "button primary"),
              button("Add shortcut", () => shortcutDialog(group.id)),
            ],
          ),
        );
      }
      return;
    }

    const topGroups = plugin ? plugin.groups : enabled().flatMap(({ groups }) => groups);
    if (topGroups.length) content.append(grid("group-grid", ordered(topGroups).map(groupCard)));
    else
      content.append(
        emptyState(
          "Create a group",
          "Organize shortcuts by project, activity or anything you like.",
          [button("New group", () => groupDialog(), "button primary")],
        ),
      );
    if (topGroups.length && groups().every(({ group }) => group.shortcuts.length === 0)) {
      content.append(
        emptyState(
          "Pin your apps",
          "Find applications installed on this PC and add them with their icons.",
          [button("Find installed apps", () => appsDialog(topGroups[0].id), "button primary")],
        ),
      );
    }
  }

  function textOrError(control, label) {
    const value = control.value.trim();
    if (!value) throw new Error(`Enter ${label}.`);
    return value;
  }

  function destinationOptions(skip = "", pluginId) {
    return groups()
      .filter(
        ({ group, parents, plugin }) =>
          (!pluginId || plugin.id === pluginId) &&
          group.id !== skip &&
          !parents.some(({ id }) => id === skip),
      )
      .map(({ group, plugin, parents }) => [
        group.id,
        [plugin.name, ...parents.map(({ name }) => name), group.name].join(" / "),
      ]);
  }

  function positionButtons(items, item, move) {
    const index = items.findIndex(({ id }) => id === item.id);
    const earlier = iconButton("↑", `Move ${item.name} earlier`, () => move(-1));
    const later = iconButton("↓", `Move ${item.name} later`, () => move(1));
    earlier.disabled = index <= 0;
    later.disabled = index < 0 || index === items.length - 1;
    return [earlier, later];
  }

  function move(items, id, delta) {
    const index = items.findIndex((item) => item.id === id);
    const other = index + delta;
    if (index < 0 || other < 0 || other >= items.length) return;
    [items[index], items[other]] = [items[other], items[index]];
  }

  function showManualOrder() {
    $("sort").value = "manual";
    localStorage.setItem("axis-hub-sort", "manual");
  }

  function groupDialog(groupId) {
    const entry = groupId && groupById(groupId);
    const { group, siblings, parents } = entry || {};
    const pluginId =
      entry?.plugin.id ||
      (route.kind === "plugin" ? route.id : groupById(route.id)?.plugin.id) ||
      "launcher";
    const body = showDialog(group ? "Edit group" : "New group");
    const name = input(group?.name, "e.g. Gaming");
    name.required = true;
    const color = select(
      Object.keys(colors).map((key) => [key, key[0].toUpperCase() + key.slice(1)]),
      group?.color || "mint",
    );
    const container = select(
      [
        ...enabled().map(({ id, name }) => [`plugin:${id}`, `${name} / Top level`]),
        ...destinationOptions(groupId).map(([id, label]) => [`group:${id}`, label]),
      ],
      parents?.length
        ? `group:${parents.at(-1).id}`
        : !group && route.kind === "group"
          ? `group:${route.id}`
          : `plugin:${pluginId}`,
    );
    body.append(field("Name", name), field("Color", color), field("Location", container));
    const extra = [];
    if (group) {
      extra.push(
        ...positionButtons(siblings, group, async (delta) => {
          showManualOrder();
          await commit(
            (draft) => move(groupById(group.id, draft).siblings, group.id, delta),
            "Group order saved",
          );
        }),
      );
      extra.push(
        button(
          "Remove",
          () =>
            confirmRemoval(group.name, "This removes the group and its shortcuts from Hub.", () =>
              commit(
                (draft) => {
                  const { siblings } = groupById(group.id, draft);
                  siblings.splice(
                    siblings.findIndex(({ id }) => id === group.id),
                    1,
                  );
                },
                "Group removed",
                { kind: "home" },
              ),
            ),
          "button danger",
        ),
      );
    }
    formActions(
      body,
      group ? "Save group" : "Create group",
      () => {
        const label = textOrError(name, "a group name");
        const [type, parentId] = container.value.split(":");
        const id = group?.id || crypto.randomUUID();
        return commit(
          (draft) => {
            const destination =
              type === "plugin"
                ? enabled(draft).find(({ id }) => id === parentId).groups
                : groupById(parentId, draft).group.groups;
            const existing = groupById(id, draft);
            if (existing) {
              Object.assign(existing.group, { name: label, color: color.value });
              if (existing.siblings !== destination) {
                existing.siblings.splice(existing.siblings.indexOf(existing.group), 1);
                destination.push(existing.group);
              }
            } else
              destination.push({ id, name: label, color: color.value, groups: [], shortcuts: [] });
          },
          group ? "Group saved" : "Group created",
          { kind: "group", id },
        );
      },
      extra,
    );
  }

  function confirmRemoval(name, detail, action) {
    const body = showDialog(`Remove ${name}?`);
    body.append(el("p", "field-hint", detail));
    formActions(body, "Remove", action);
  }

  function targetValue(target) {
    return target.path ?? target.url ?? target.id;
  }

  function shortcutDialog(groupId, existing) {
    const destinations = destinationOptions();
    if (!destinations.length) {
      groupDialog();
      return;
    }
    const body = showDialog(existing ? "Edit shortcut" : "Add shortcut");
    const currentPluginGroup =
      route.kind === "plugin" && enabled().find(({ id }) => id === route.id)?.groups[0]?.id;
    const group = select(destinations, groupId || currentPluginGroup || destinations[0][0]);
    const name = input(existing?.name, "e.g. Project files");
    name.required = true;
    const mode = select(
      existing?.target.kind === "windows-app"
        ? [
            ["windows-app", "Windows app"],
            ["path", "File or folder"],
            ["website", "Website"],
          ]
        : [
            ["path", "File or folder"],
            ["website", "Website"],
          ],
      existing?.target.kind || "path",
    );
    const target = input(existing ? targetValue(existing.target) : "", "C:\\path\\to\\file", 4096);
    target.required = true;
    const iconPreview = el("span", "icon-preview");
    let customIcon = existing?.icon || null;
    function preview() {
      iconPreview.replaceChildren(iconFor({ icon: customIcon, name: name.value || "A" }));
    }
    preview();
    const version = modalVersion;
    const stillOpen = () => dialog.open && modalVersion === version;
    const targetField = field("Target", target);
    const browse = button("Browse file", () => browsePath(false));
    const browseFolder = button("Browse folder", () => browsePath(true));
    function syncMode() {
      target.readOnly = mode.value === "windows-app";
      target.placeholder = mode.value === "website" ? "https://example.com" : "C:\\path\\to\\file";
      browse.hidden = mode.value !== "path";
      browseFolder.hidden = mode.value !== "path";
    }
    async function browsePath(directory) {
      const path = await pick({
        directory,
        multiple: false,
        title: directory ? "Choose a folder" : "Choose a file or application",
      });
      if (!path || !stillOpen()) return;
      target.value = path;
      if (!name.value.trim())
        name.value = path
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .at(-1)
          .replace(/\.(exe|lnk)$/i, "");
      preview();
    }
    mode.addEventListener("change", () => {
      target.value = existing?.target.kind === mode.value ? targetValue(existing.target) : "";
      syncMode();
    });
    name.addEventListener("input", preview);
    syncMode();
    const chooseIcon = button("Choose icon", async () => {
      const path = await pick({
        title: "Choose a shortcut icon",
        filters: [{ name: "Images", extensions: ["png", "ico", "jpg", "jpeg", "bmp", "gif"] }],
      });
      if (!path || !stillOpen()) return;
      const icon = await invoke("custom_icon", { path });
      if (stillOpen()) {
        customIcon = icon;
        preview();
      }
    });
    body.append(
      grid("field-row", [field("Name", name), field("Group", group)]),
      field("Type", mode),
      targetField,
      grid("field-row", [browse, browseFolder]),
      grid("icon-field", [
        iconPreview,
        chooseIcon,
        button("Use default icon", () => {
          customIcon = null;
          preview();
        }),
      ]),
    );
    if (!existing) body.prepend(button("Find installed apps", () => appsDialog(group.value)));
    const extras = [];
    if (existing) {
      extras.push(
        ...positionButtons(groupById(groupId).group.shortcuts, existing, async (delta) => {
          showManualOrder();
          await commit(
            (draft) => move(groupById(groupId, draft).group.shortcuts, existing.id, delta),
            "Shortcut order saved",
          );
        }),
      );
      extras.push(
        button(
          "Remove",
          () =>
            confirmRemoval(existing.name, "This removes the shortcut from Hub.", () =>
              commit((draft) => {
                const { shortcuts } = groupById(groupId, draft).group;
                shortcuts.splice(
                  shortcuts.findIndex(({ id }) => id === existing.id),
                  1,
                );
              }, "Shortcut removed"),
            ),
          "button danger",
        ),
      );
    }
    formActions(
      body,
      existing ? "Save shortcut" : "Add shortcut",
      async () => {
        const value = textOrError(target, "a target");
        const label = textOrError(name, "a shortcut name");
        const kind = mode.value;
        const destination = group.value;
        const launchTarget =
          kind === "path"
            ? { kind, path: value }
            : kind === "website"
              ? { kind, url: value }
              : { kind, id: value };
        const icon = customIcon || (await invoke("target_icon", { target: launchTarget }));
        if (!stillOpen()) return;
        const shortcut = {
          id: existing?.id || crypto.randomUUID(),
          name: label,
          target: launchTarget,
          icon,
        };
        return commit(
          (draft) => {
            const items = groupById(destination, draft).group.shortcuts;
            if (existing) {
              const original = groupById(groupId, draft).group.shortcuts;
              const index = original.findIndex(({ id }) => id === existing.id);
              if (original === items) {
                items[index] = shortcut;
                return;
              }
              original.splice(index, 1);
            }
            items.push(shortcut);
          },
          existing ? "Shortcut saved" : "Shortcut added",
          { kind: "group", id: destination },
        );
      },
      extras,
    );
  }

  async function appsDialog(groupId) {
    const destinations = destinationOptions();
    if (!destinations.length) {
      groupDialog();
      return;
    }
    const body = showDialog("Find installed apps");
    const version = modalVersion;
    const group = select(destinations, groupId || destinations[0][0]);
    const search = input("", "Search installed apps");
    const results = el("div", "app-results");
    results.setAttribute("aria-label", "Installed applications");
    const selected = new Map();
    body.append(field("Add to group", group), field("Search apps", search), results);
    const save = formActions(body, "Add selected apps", async () => {
      if (!selected.size) throw new Error("Select an application to add.");
      const added = [];
      const destination = group.value;
      for (const { name, target, icon } of [...selected.values()]) {
        const resolved = icon || (await invoke("target_icon", { target }));
        if (!dialog.open || modalVersion !== version) return;
        added.push({
          id: crypto.randomUUID(),
          name: [...name].slice(0, 100).join(""),
          target,
          icon: resolved,
        });
      }
      return commit(
        (draft) => groupById(destination, draft).group.shortcuts.push(...added),
        `${added.length} ${added.length === 1 ? "app" : "apps"} added`,
        { kind: "group", id: destination },
      );
    });
    save.disabled = true;
    search.disabled = true;
    results.append(el("p", "field-hint", "Looking for installed Windows applications…"));
    appDiscovery ??= invoke("apps").finally(() => {
      appDiscovery = undefined;
    });
    try {
      const apps = await appDiscovery;
      if (!dialog.open || version !== modalVersion) return;
      function list() {
        const filter = search.value.trim().toLocaleLowerCase();
        const items = apps.filter(({ name }) => name.toLocaleLowerCase().includes(filter));
        results.replaceChildren(
          ...items.map((app) => {
            const row = el("label", "app-result");
            const check = el("input");
            const key = targetValue(app.target);
            check.type = "checkbox";
            check.checked = selected.has(key);
            check.addEventListener("change", () => {
              if (check.checked) selected.set(key, app);
              else selected.delete(key);
              save.disabled = !selected.size;
              save.textContent = selected.size
                ? `Add ${selected.size} ${selected.size === 1 ? "app" : "apps"}`
                : "Add selected apps";
            });
            const icon = iconFor(app);
            if (icon instanceof HTMLImageElement) icon.loading = "lazy";
            row.append(icon, el("span", "app-result-name", app.name), check);
            return row;
          }),
        );
        if (!items.length)
          results.append(
            el("p", "field-hint", "No matching apps. You can still add one by filepath."),
          );
      }
      search.disabled = false;
      search.addEventListener("input", list);
      search.focus();
      list();
    } catch (error) {
      if (dialog.open && version === modalVersion) {
        results.replaceChildren(button("Try again", () => appsDialog(group.value)));
        showError(error);
      }
    }
  }

  function renderPlugins() {
    const file = el("input");
    file.type = "file";
    file.id = "plugin-file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.addEventListener("change", async () => {
      const selected = file.files[0];
      file.value = "";
      if (!selected) return;
      try {
        if (selected.size > 24 * 1024 * 1024) throw new Error("Plugin file exceeds 24 MiB.");
        const pack = await invoke("validate_plugin", { contents: await selected.text() });
        if (!file.isConnected) return;
        importDialog(pack);
      } catch (error) {
        if (file.isConnected) showError(error);
      }
    });
    const actions = grid("section-actions", [
      button("Import plugin", () => file.click(), "button primary"),
      button("New plugin", () => newPlugin()),
      file,
    ]);
    const cards = library.plugins.map((plugin) => {
      const card = el("article", "plugin-card");
      const information = el("div", "plugin-info");
      information.append(
        el("h2", "", plugin.name),
        el("p", "", plugin.description || "Shortcut pack"),
      );
      const controls = el("div", "plugin-actions");
      if (plugin.enabled)
        controls.append(button("Open", () => navigate({ kind: "plugin", id: plugin.id })));
      if (plugin.id !== "launcher") {
        controls.append(
          button(plugin.enabled ? "Disable" : "Enable", () =>
            commit(
              (draft) => {
                draft.plugins.find(({ id }) => id === plugin.id).enabled = !plugin.enabled;
              },
              plugin.enabled ? "Plugin disabled" : "Plugin enabled",
            ),
          ),
        );
        controls.append(
          iconButton("×", `Remove ${plugin.name} plugin`, () =>
            confirmRemoval(plugin.name, "This removes the plugin and its shortcuts from Hub.", () =>
              commit((draft) => {
                draft.plugins = draft.plugins.filter(({ id }) => id !== plugin.id);
              }, "Plugin removed"),
            ),
          ),
        );
      }
      card.append(el("span", "plugin-icon", "▦"), information, controls);
      return card;
    });
    return grid("plugins-view", [actions, grid("plugins-list", cards)]);
  }

  function newPlugin() {
    const body = showDialog("New plugin");
    const name = input("", "Plugin name");
    name.required = true;
    const description = input("", "Optional description", 500);
    body.append(field("Name", name), field("Description", description));
    formActions(body, "Create plugin", () => {
      const id = crypto.randomUUID();
      return commit(
        (draft) =>
          draft.plugins.push({
            id,
            name: textOrError(name, "a plugin name"),
            description: description.value.trim(),
            enabled: true,
            groups: [],
          }),
        "Plugin created",
        { kind: "plugin", id },
      );
    });
  }

  function importDialog(pack) {
    const body = showDialog(`Install ${pack.name}`);
    if (pack.description) body.append(el("p", "field-hint", pack.description));
    const preview = el("div", "import-preview");
    function previewGroups(groups, depth) {
      for (const group of groups) {
        const line = el("strong", "import-group", group.name);
        line.style.setProperty("--depth", String(depth));
        preview.append(line);
        for (const shortcut of group.shortcuts) {
          const line = el(
            "p",
            "import-shortcut",
            `${shortcut.name} · ${targetValue(shortcut.target)}`,
          );
          line.style.setProperty("--depth", String(depth + 1));
          preview.append(line);
        }
        previewGroups(group.groups, depth + 1);
      }
    }
    previewGroups(pack.groups, 0);
    body.append(
      el("p", "field-hint", "Review the shortcuts and their targets before installing."),
      preview,
    );
    function copyGroup({ name, color, groups, shortcuts }) {
      return {
        id: crypto.randomUUID(),
        name,
        color,
        groups: groups.map(copyGroup),
        shortcuts: shortcuts.map((shortcut) => ({ ...shortcut, id: crypto.randomUUID() })),
      };
    }
    formActions(body, "Install plugin", () => {
      const id = crypto.randomUUID();
      return commit(
        (draft) =>
          draft.plugins.push({
            id,
            name: pack.name,
            description: pack.description,
            enabled: true,
            groups: pack.groups.map(copyGroup),
          }),
        "Plugin installed",
        { kind: "plugin", id },
      );
    });
  }

  async function init() {
    const sort = $("sort");
    const storedSort = localStorage.getItem("axis-hub-sort");
    if (["manual", "name", "type"].includes(storedSort)) sort.value = storedSort;
    try {
      ({ library, revision } = await invoke("load"));
      if (disposed) return;
    } catch (error) {
      if (disposed) return;
      $("content").replaceChildren(emptyState("Library unavailable", String(error)));
      $("content").setAttribute("aria-busy", "false");
      for (const id of ["search", "sort", "add-group", "add-shortcut", "plugins-button"])
        $(id).disabled = true;
      return;
    }
    $("nav-home").addEventListener("click", () => navigate({ kind: "home" }));
    $("plugins-button").addEventListener("click", () => navigate({ kind: "plugins" }));
    $("add-group").addEventListener("click", () => groupDialog());
    $("add-shortcut").addEventListener("click", () =>
      shortcutDialog(route.kind === "group" ? route.id : undefined),
    );
    $("dialog-close").addEventListener("click", () => dialog.close());
    $("search").addEventListener("input", renderContent);
    sort.addEventListener("change", () => {
      localStorage.setItem("axis-hub-sort", sort.value);
      renderContent();
    });
    $("app-shell").addEventListener("keydown", (event) => {
      if (
        !dialog.open &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        route.kind !== "plugins"
      ) {
        event.preventDefault();
        $("search").focus();
      }
    });
    $("content").setAttribute("aria-busy", "false");
    render();
  }

  const unsubscribe = subscribe(() => void refresh());
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("close", () => {
    if (pendingRefresh) void refresh();
  });
  void init();
  return () => {
    disposed = true;
    unsubscribe();
    clearTimeout(noticeTimer);
    if (dialog.open) dialog.close();
  };
}
