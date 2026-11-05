import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { backend } from "./ipc";
import "./styles/theme.css";
import "./styles/themes.css";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);

// The Agent's own window loads this page with `?agent` and shows only the Agent.
if (new URLSearchParams(location.search).has("agent")) {
  document.documentElement.classList.add("agent-window");
  void import("./features/agent/AgentApp").then(({ AgentApp }) =>
    root.render(
      <StrictMode>
        <AgentApp />
      </StrictMode>,
    ),
  );
} else {
  // No system frame on the desktop: the tab row leaves room for the window's own buttons.
  if (backend.windowFrame) document.documentElement.classList.add("framed");
  void import("./App").then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
