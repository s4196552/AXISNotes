import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { mountHub, type HubBridge } from "./launcher.js";
import markup from "./launcher.html?raw";
import styles from "./launcher.css?raw";

const viewers = new Set<() => void>();

function createBridge(): HubBridge {
  let listener: (() => void) | undefined;
  return {
    async invoke(command, args) {
      if (!("__TAURI_INTERNALS__" in window)) {
        throw new Error("AXIS Hub shortcuts are available in the desktop app.");
      }
      const result = await invoke(`hub_${command}`, args);
      if (command === "save") {
        for (const refresh of viewers) if (refresh !== listener) refresh();
      }
      return result;
    },
    pick: open,
    subscribe(refresh) {
      listener = refresh;
      viewers.add(refresh);
      window.addEventListener("focus", refresh);
      return () => {
        viewers.delete(refresh);
        window.removeEventListener("focus", refresh);
      };
    },
  };
}

export function HubView({ mode = "launcher" }: { mode?: "launcher" | "settings" }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current!;
    const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = styles;
    const template = document.createElement("template");
    template.innerHTML = markup;
    root.replaceChildren(style, template.content);
    const dispose = mountHub(root, createBridge(), mode);
    return () => {
      dispose();
      root.replaceChildren();
    };
  }, [mode]);
  return <div ref={host} data-axis-hub={mode} aria-label="AXIS Hub" />;
}
