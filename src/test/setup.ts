import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library can't register its auto-cleanup.
afterEach(cleanup);

// Open tabs and split panes are saved per vault in local storage; don't carry them into the
// next test.
afterEach(() => {
  // Test files that don't need a DOM run in Node, without local storage (T-284).
  if (typeof localStorage === "undefined") return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("axisnotes.tabs:") || key.startsWith("axisnotes.panes:")) {
      localStorage.removeItem(key);
    }
  }
});

// waitFor/findBy default to 1 s, which busy machines can exceed.
configure({ asyncUtilTimeout: 5000 });
