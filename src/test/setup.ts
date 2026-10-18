import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadFunctions } from "../lib/formula/functions";

// Vitest globals are off, so Testing Library can't register its auto-cleanup.
afterEach(cleanup);

// Open tabs are saved per vault in local storage; don't carry them into the next test.
afterEach(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("axisnotes.tabs:")) localStorage.removeItem(key);
  }
});

// waitFor/findBy default to 1 s, which busy machines can exceed.
configure({ asyncUtilTimeout: 5000 });

// Formula functions load lazily in the app; tests evaluate formulas synchronously.
await loadFunctions();
