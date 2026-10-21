import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { backend } from "./ipc";
import "./styles/theme.css";
import "./styles/themes.css";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);

if ("__AXIS_UPDATER__" in window) {
  // The update window (see src-tauri/src/updater.rs), in the app's dark palette.
  document.documentElement.dataset.theme = "dark";
  void import("./features/updates/UpdaterWindow").then(({ UpdaterWindow }) =>
    root.render(
      <StrictMode>
        <UpdaterWindow />
      </StrictMode>,
    ),
  );
} else {
  // No system frame on the desktop: the tab row leaves room for the window's own buttons.
  if (backend.windowFrame) document.documentElement.classList.add("framed");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
