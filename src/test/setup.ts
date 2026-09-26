import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library can't register its auto-cleanup.
afterEach(cleanup);

// waitFor/findBy default to 1 s, which busy machines can exceed.
configure({ asyncUtilTimeout: 5000 });
