import { Grid2X2 } from "lucide-react";
import { showLeftPanel } from "../../app/layout";
import { useAppStore } from "../../app/store";
import { registerRibbonItem } from "../ribbon/registry";

// AXIS Hub's ribbon button: a plugin adds its buttons like this. It shows only while the
// plugin is turned on (Settings → Plugins), like the Hub's sidebar tab.
registerRibbonItem({
  id: "hub:open",
  label: "AXIS Hub",
  Icon: Grid2X2,
  source: "AXIS Hub",
  available: (config) => config.hubEnabled,
  run: () => {
    showLeftPanel();
    useAppStore.getState().setLeftPanel("hub");
  },
});
