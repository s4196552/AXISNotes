import {
  CalendarDays,
  Clock,
  Command,
  FilePlus,
  House,
  ListChecks,
  Network,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import { allCommands } from "../commands/registry";
import { useAppStore } from "../../app/store";
import { showLeftPanel, useLayout } from "../../app/layout";
import { openSidebarChat, useSidebarChat } from "../ai/sidebarChatState";
import { registerRibbonItem } from "./registry";

/** Run an app command by id (the same action as its shortcut and the palette). */
const command = (id: string) => () =>
  allCommands()
    .find((c) => c.id === id)
    ?.run();

// AXISNotes' own ribbon buttons, in their default order.
for (const item of [
  {
    id: "core:home",
    label: "Home",
    Icon: House,
    run: () => useAppStore.getState().openDashboard(""),
  },
  {
    id: "core:new-note",
    label: "New note",
    Icon: FilePlus,
    run: command("new-note"),
  },
  {
    id: "core:daily",
    label: "Today's daily note",
    Icon: CalendarDays,
    run: command("daily"),
  },
  {
    id: "core:search",
    label: "Search",
    Icon: Search,
    run: () => {
      showLeftPanel();
      useAppStore.getState().setLeftPanel("search");
    },
  },
  {
    id: "core:ai",
    label: "AI chat",
    Icon: Sparkles,
    // Opens AI chat about the open note; pressed again while it's showing, closes it.
    run: () => {
      const right = useLayout.getState();
      const showing = useSidebarChat.getState().open && (right.right || right.overlay === "right");
      if (showing) useSidebarChat.setState({ open: false });
      else openSidebarChat();
    },
  },
  {
    id: "core:graph",
    label: "Graph view",
    Icon: Network,
    run: () => useAppStore.getState().setMainView("graph"),
  },
  {
    id: "core:tasks",
    label: "Tasks",
    Icon: ListChecks,
    run: () => useAppStore.getState().setMainView("tasks"),
  },
  {
    id: "core:time",
    label: "Time report",
    Icon: Clock,
    run: () => useAppStore.getState().setMainView("time"),
  },
  {
    id: "core:switcher",
    label: "Quick switcher",
    Icon: SquareArrowOutUpRight,
    run: command("switcher"),
  },
  {
    id: "core:palette",
    label: "Command palette",
    Icon: Command,
    run: command("palette"),
  },
])
  registerRibbonItem({ ...item, source: "AXISNotes" });
