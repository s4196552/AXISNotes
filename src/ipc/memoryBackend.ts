import type { Backend, BackendError, ErrorCode, VaultChange, VaultEntry, VaultInfo } from "./types";

// In-memory implementation of the Backend contract. Used by unit tests and when the
// UI runs in a plain browser (`pnpm dev` without Tauri). Mirrors the Rust semantics.

interface Node {
  kind: "file" | "dir";
  content: string;
  modifiedMs: number;
}

function fail(code: ErrorCode, message: string): never {
  throw { code, message } satisfies BackendError;
}

function normalize(path: string): string {
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) fail("OutsideVault", path);
  return parts.join("/");
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const BAD_NAME = /[<>:"\\|?*]/;

function validateName(name: string) {
  if (!name || name !== name.trim() || name.endsWith(".") || BAD_NAME.test(name)) {
    fail("InvalidName", name);
  }
}

export interface MemoryBackend extends Backend {
  /** Simulate an edit made by another program (fires onVaultChanged). */
  externalWrite(path: string, content: string): void;
  /** Direct access for assertions in tests. */
  files(): Record<string, string>;
}

export function createMemoryBackend(
  initial: Record<string, string> = {},
  vaultName = "Demo Vault",
): MemoryBackend {
  const nodes = new Map<string, Node>();
  const listeners = new Set<(c: VaultChange[]) => void>();
  let clock = 1_700_000_000_000;
  const tick = () => ++clock;
  let vault: VaultInfo | null = { root: `/memory/${vaultName}`, name: vaultName };

  const ensureDirs = (path: string) => {
    let p = parentOf(path);
    while (p !== "") {
      if (!nodes.has(p)) nodes.set(p, { kind: "dir", content: "", modifiedMs: tick() });
      p = parentOf(p);
    }
  };
  const put = (path: string, node: Node) => {
    ensureDirs(path);
    nodes.set(path, node);
  };
  for (const [path, content] of Object.entries(initial)) {
    put(normalize(path), { kind: "file", content, modifiedMs: tick() });
  }

  const requireVault = () => {
    if (!vault) fail("NoVault", "no vault is open");
  };
  const entry = (path: string, recurse = true): VaultEntry => {
    const node = nodes.get(path);
    const kind = path === "" ? "dir" : node!.kind;
    const e: VaultEntry = {
      path,
      name: path === "" ? (vault?.name ?? "") : baseName(path),
      kind,
      modifiedMs: node?.modifiedMs ?? 0,
    };
    if (kind === "dir") {
      e.children = recurse
        ? [...nodes.keys()]
            .filter((k) => k !== path && parentOf(k) === path && !baseName(k).startsWith("."))
            .map((k) => entry(k))
            .sort(
              (a, b) =>
                Number(a.kind !== "dir") - Number(b.kind !== "dir") ||
                a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
            )
        : [];
    }
    return e;
  };

  return {
    async pickFolder() {
      return "/memory";
    },
    async openVault(path) {
      vault = { root: path, name: baseName(path) || path };
      return vault;
    },
    async createVault(parentDir, name) {
      validateName(name);
      nodes.clear();
      vault = { root: `${parentDir}/${name}`, name };
      return vault;
    },
    async currentVault() {
      return vault;
    },
    async listTree() {
      requireVault();
      return entry("");
    },
    async readFile(path) {
      requireVault();
      const p = normalize(path);
      const n = nodes.get(p);
      if (!n || n.kind !== "file") fail("NotFound", path);
      return { content: n.content, modifiedMs: n.modifiedMs };
    },
    async writeFile(path, content, expectedModifiedMs) {
      requireVault();
      const p = normalize(path);
      if (p === "") fail("OutsideVault", path);
      const n = nodes.get(p);
      if (n && expectedModifiedMs !== undefined && n.modifiedMs !== expectedModifiedMs) {
        fail("Conflict", path);
      }
      const modifiedMs = tick();
      put(p, { kind: "file", content, modifiedMs });
      return { modifiedMs };
    },
    async createFile(path, content = "") {
      requireVault();
      const p = normalize(path);
      if (p === "") fail("OutsideVault", path);
      validateName(baseName(p));
      if (nodes.has(p)) fail("AlreadyExists", path);
      put(p, { kind: "file", content, modifiedMs: tick() });
      return entry(p);
    },
    async createDir(path) {
      requireVault();
      const p = normalize(path);
      if (p === "") fail("OutsideVault", path);
      validateName(baseName(p));
      if (nodes.has(p)) fail("AlreadyExists", path);
      put(p, { kind: "dir", content: "", modifiedMs: tick() });
      return entry(p);
    },
    async renameEntry(from, to) {
      requireVault();
      const src = normalize(from);
      const dst = normalize(to);
      if (src === "" || dst === "") fail("OutsideVault", from);
      validateName(baseName(dst));
      if (!nodes.has(src)) fail("NotFound", from);
      if (dst.startsWith(src + "/")) fail("InvalidName", `cannot move ${from} into itself`);
      const caseOnly = src.toLowerCase() === dst.toLowerCase();
      if (nodes.has(dst) && !caseOnly) fail("AlreadyExists", to);
      const moved = [...nodes.entries()].filter(([k]) => k === src || k.startsWith(src + "/"));
      for (const [k] of moved) nodes.delete(k);
      ensureDirs(dst);
      for (const [k, n] of moved) nodes.set(dst + k.slice(src.length), n);
      return entry(dst);
    },
    async trashEntry(path) {
      requireVault();
      const p = normalize(path);
      if (p === "") fail("OutsideVault", path);
      if (!nodes.has(p)) fail("NotFound", path);
      for (const k of [...nodes.keys()]) if (k === p || k.startsWith(p + "/")) nodes.delete(k);
    },
    async onVaultChanged(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    externalWrite(path, content) {
      const p = normalize(path);
      const existed = nodes.has(p);
      put(p, { kind: "file", content, modifiedMs: tick() });
      const change: VaultChange = { kind: existed ? "modified" : "created", paths: [p] };
      listeners.forEach((l) => l([change]));
    },
    files() {
      return Object.fromEntries(
        [...nodes.entries()].filter(([, n]) => n.kind === "file").map(([k, n]) => [k, n.content]),
      );
    },
  };
}

/** Sample content shown when the UI runs in a browser without Tauri. */
export const DEMO_VAULT: Record<string, string> = {
  "Welcome.md":
    "# Welcome to AXIS\n\nThis is **demo** content from the in-memory backend.\n\n- Notes are plain Markdown\n- [[Links]] come in Phase 1\n",
  "School/Biology.md":
    "# Biology\n\n## Cells\n\nThe *mitochondria* is the powerhouse of the cell.\n",
  "School/Math/Calculus.md": "# Calculus\n\n```\nd/dx x^2 = 2x\n```\n",
  "Personal/Ideas.md": "# Ideas\n\n1. Build AXIS\n2. Ship it\n",
};
