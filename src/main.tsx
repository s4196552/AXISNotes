import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { backend } from "./ipc";
import "./styles/theme.css";
import "./styles/themes.css";
import "./styles/app.css";

// No system frame on the desktop: the tab row leaves room for the window's own buttons.
if (backend.windowFrame) document.documentElement.classList.add("framed");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
