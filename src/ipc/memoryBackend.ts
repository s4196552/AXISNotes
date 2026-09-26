import {
  aliasesOf,
  findTags,
  findWikilinks,
  isNotePath,
  maskCode,
  noteName,
  splitFrontmatter,
} from "../lib/markdown";
import type {
  Backend,
  BackendError,
  Backlink,
  ErrorCode,
  GraphData,
  Mention,
  SearchHit,
  VaultChange,
  VaultEntry,
  VaultInfo,
} from "./types";
import { HL_END, HL_START } from "./types";

// In-memory implementation of the Backend contract. Used by unit tests and when the
// UI runs in a plain browser (`pnpm dev` without Tauri). Mirrors the Rust semantics.

interface Node {
  kind: "file" | "dir";
  content: string;
  modifiedMs: number;
}

// Same wording as `AppError`'s Display impl in src-tauri/src/error.rs.
const PREFIX: Record<ErrorCode, string> = {
  NoVault: "",
  NotFound: "not found: ",
  AlreadyExists: "already exists: ",
  Conflict: "file changed on disk since it was loaded: ",
  OutsideVault: "path is outside the vault: ",
  InvalidName: "invalid name: ",
  Io: "",
};

function fail(code: ErrorCode, detail: string): never {
  throw { code, message: PREFIX[code] + detail } satisfies BackendError;
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
  /** Simulate another program deleting a file or folder (fires onVaultChanged). */
  externalRemove(path: string): void;
  /** Emit raw watcher changes without touching files (for edge cases in tests). */
  emitChanges(changes: VaultChange[]): void;
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

  // ---- Simplified index (mirrors src-tauri/src/index for tests and browser dev) ----
  const notes = () =>
    [...nodes.entries()]
      .filter(([k, n]) => n.kind === "file" && isNotePath(k))
      .map(([path, n]) => ({ path, text: n.content }));

  const resolve = (target: string, from: string): string | null => {
    let t = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (t.toLowerCase().endsWith(".md")) t = t.slice(0, -3);
    if (!t) return from;
    const name = noteName(t).toLowerCase();
    let candidates = notes()
      .map((n) => n.path)
      .filter((p) => noteName(p).toLowerCase() === name);
    if (t.includes("/")) {
      const want = t.toLowerCase();
      candidates = candidates.filter((p) => {
        const q = p.slice(0, -3).toLowerCase();
        return q === want || q.endsWith("/" + want);
      });
    }
    if (candidates.length === 0 && !t.includes("/")) {
      candidates = notes()
        .filter((n) =>
          aliasesOf(splitFrontmatter(n.text).props).some(
            (a) => a.toLowerCase() === t.toLowerCase(),
          ),
        )
        .map((n) => n.path);
    }
    const dir = parentOf(from);
    candidates.sort(
      (a, b) =>
        Number(parentOf(a) !== dir) - Number(parentOf(b) !== dir) ||
        a.length - b.length ||
        a.localeCompare(b),
    );
    return candidates[0] ?? null;
  };

  const lineOf = (text: string, pos: number) => {
    const start = text.lastIndexOf("\n", pos - 1) + 1;
    const endIdx = text.indexOf("\n", pos);
    return {
      line: text.slice(0, start).split("\n").length,
      context: text.slice(start, endIdx === -1 ? text.length : endIdx).replace(/\r$/, ""),
    };
  };

  const snippet = (text: string, needle: string) => {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i === -1) return "";
    const from = Math.max(0, i - 40);
    return (
      (from > 0 ? "…" : "") +
      text.slice(from, i) +
      HL_START +
      text.slice(i, i + needle.length) +
      HL_END +
      text.slice(i + needle.length, i + needle.length + 60)
    );
  };

  const search = (query: string, limit = 50): SearchHit[] => {
    const tokens = [...query.matchAll(/(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)];
    if (tokens.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const n of notes()) {
      const fm = splitFrontmatter(n.text);
      const body = n.text.slice(fm.length);
      const hay = body.toLowerCase();
      const tags = findTags(n.text);
      let firstWord = "";
      const ok = tokens.every(([, neg, op, quoted, bare]) => {
        const v = (quoted ?? bare ?? "").toLowerCase();
        const tagMatch = (t: string) => tags.some((x) => x === t || x.startsWith(t + "/"));
        let match: boolean;
        switch (op?.toLowerCase()) {
          case "tag":
            match = tagMatch(v.replace(/^#/, ""));
            break;
          case "path":
            match = n.path.toLowerCase().includes(v);
            break;
          case "file":
            match = noteName(n.path).toLowerCase().includes(v);
            break;
          case "prop": {
            const [k = "", want] = v.split("=");
            const key = Object.keys(fm.props).find((x) => x.toLowerCase() === k);
            const val = key === undefined ? undefined : fm.props[key];
            match =
              key !== undefined &&
              (want === undefined || [val].flat().some((x) => String(x).toLowerCase() === want));
            break;
          }
          default:
            match = v.startsWith("#") ? tagMatch(v.slice(1)) : hay.includes(v);
            if (match && !neg && !firstWord && !v.startsWith("#")) firstWord = v;
        }
        return neg ? !match : match;
      });
      if (ok) {
        hits.push({
          path: n.path,
          title: noteName(n.path),
          snippet: firstWord ? snippet(body, firstWord) : "",
        });
      }
    }
    return hits.slice(0, limit);
  };

  const incoming = (path: string) =>
    notes().flatMap((n) =>
      findWikilinks(n.text)
        .filter((l) => resolve(l.target, n.path) === path)
        .map((l) => ({ source: n.path, text: n.text, link: l })),
    );

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
      const sites = moved
        .filter(([k]) => isNotePath(k))
        .flatMap(([k]) =>
          incoming(k).map((site) => ({ ...site, newPath: dst + k.slice(src.length) })),
        );
      for (const [k] of moved) nodes.delete(k);
      ensureDirs(dst);
      for (const [k, n] of moved) nodes.set(dst + k.slice(src.length), n);

      // Rewrite links that no longer resolve (same rules as the Rust core).
      const bySource = new Map<string, { from: number; to: number; text: string }[]>();
      for (const site of sites) {
        const inMoved = site.source === src || site.source.startsWith(src + "/");
        const source = inMoved ? dst + site.source.slice(src.length) : site.source;
        if (resolve(site.link.target, source) === site.newPath) continue;
        const full = site.newPath.slice(0, -3);
        let target = site.link.target.includes("/") ? full : noteName(site.newPath);
        if (resolve(target, source) !== site.newPath) target = full;
        const raw = site.text.slice(site.link.from, site.link.to);
        const list = bySource.get(source) ?? [];
        list.push({
          from: site.link.from,
          to: site.link.to,
          text: raw.replace(site.link.target, target),
        });
        bySource.set(source, list);
      }
      const updated: string[] = [];
      for (const [source, edits] of bySource) {
        const node = nodes.get(source);
        if (!node) continue;
        let text = node.content;
        for (const e of edits.sort((a, b) => b.from - a.from)) {
          text = text.slice(0, e.from) + e.text + text.slice(e.to);
        }
        nodes.set(source, { ...node, content: text, modifiedMs: tick() });
        updated.push(source);
      }
      if (updated.length) listeners.forEach((l) => l([{ kind: "modified", paths: updated }]));
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
    async search(query, limit) {
      requireVault();
      return search(query, limit);
    },
    async listTags() {
      requireVault();
      const counts = new Map<string, number>();
      for (const n of notes()) {
        for (const t of findTags(n.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([tag, count]) => ({ tag, count }));
    },
    async listNotes() {
      requireVault();
      return notes()
        .map((n) => {
          const fm = splitFrontmatter(n.text);
          const h1 = /^#[ \t]+(.+)$/m.exec(n.text.slice(fm.length));
          return {
            path: n.path,
            name: noteName(n.path),
            title: h1?.[1]?.trim() ?? null,
            aliases: aliasesOf(fm.props),
          };
        })
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },
    async resolveLink(target, from) {
      requireVault();
      return resolve(target, from);
    },
    async backlinks(path) {
      requireVault();
      const out: Backlink[] = [];
      for (const { source, text, link } of incoming(path)) {
        if (source === path) continue;
        const { line, context } = lineOf(text, link.from);
        let b = out.find((x) => x.source === source);
        if (!b) out.push((b = { source, links: [] }));
        b.links.push({ line, context, embed: link.embed });
      }
      return out.sort((a, b) => (a.source < b.source ? -1 : 1));
    },
    async graph() {
      requireVault();
      const data: GraphData = { nodes: [], edges: [] };
      const ghosts = new Set<string>();
      const seen = new Set<string>();
      for (const n of notes()) {
        data.nodes.push({
          id: n.path,
          name: noteName(n.path),
          tags: findTags(n.text),
          unresolved: false,
        });
        for (const l of findWikilinks(n.text)) {
          if (!l.target.trim()) continue;
          const target = resolve(l.target, n.path) ?? `?${l.target.trim().replace(/\.md$/i, "")}`;
          if (target.startsWith("?")) ghosts.add(target);
          const key = `${n.path}\u0000${target}`;
          if (target !== n.path && !seen.has(key)) {
            seen.add(key);
            data.edges.push({ source: n.path, target });
          }
        }
      }
      for (const g of ghosts)
        data.nodes.push({ id: g, name: noteName(g.slice(1)), tags: [], unresolved: true });
      data.nodes.sort(
        (a, b) => Number(a.unresolved) - Number(b.unresolved) || (a.id < b.id ? -1 : 1),
      );
      return data;
    },
    async listAxisFiles(subdir) {
      const prefix = `.axis/${subdir}/`;
      return [...nodes.keys()]
        .filter(
          (k) =>
            k.startsWith(prefix) && k.endsWith(".css") && !k.slice(prefix.length).includes("/"),
        )
        .map((k) => k.slice(prefix.length, -4))
        .sort();
    },
    async unlinkedMentions(path) {
      requireVault();
      const target = notes().find((n) => n.path === path);
      const terms = [
        noteName(path),
        ...(target ? aliasesOf(splitFrontmatter(target.text).props) : []),
      ].filter((t) => t.length >= 2);
      const out: Mention[] = [];
      const wordChar = /[\p{L}\p{N}]/u;
      for (const n of notes()) {
        if (n.path === path) continue;
        const fmLen = splitFrontmatter(n.text).length;
        let masked = maskCode(n.text);
        for (const l of findWikilinks(n.text)) {
          masked = masked.slice(0, l.from) + " ".repeat(l.to - l.from) + masked.slice(l.to);
        }
        const lower = masked.toLowerCase();
        for (const term of terms) {
          const needle = term.toLowerCase();
          for (
            let i = lower.indexOf(needle, fmLen);
            i !== -1;
            i = lower.indexOf(needle, i + needle.length)
          ) {
            const before = n.text[i - 1];
            const after = n.text[i + needle.length];
            if ((before && wordChar.test(before)) || (after && wordChar.test(after))) continue;
            out.push({
              source: n.path,
              ...lineOf(n.text, i),
              text: n.text.slice(i, i + needle.length),
              start: i,
              end: i + needle.length,
            });
          }
        }
      }
      return out.sort((a, b) =>
        a.source < b.source ? -1 : a.source > b.source ? 1 : a.start - b.start,
      );
    },
    externalWrite(path, content) {
      const p = normalize(path);
      const existed = nodes.has(p);
      put(p, { kind: "file", content, modifiedMs: tick() });
      const change: VaultChange = { kind: existed ? "modified" : "created", paths: [p] };
      listeners.forEach((l) => l([change]));
    },
    externalRemove(path) {
      const p = normalize(path);
      for (const k of [...nodes.keys()]) if (k === p || k.startsWith(p + "/")) nodes.delete(k);
      listeners.forEach((l) => l([{ kind: "removed", paths: [p] }]));
    },
    emitChanges(changes) {
      listeners.forEach((l) => l(changes));
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
  "Personal/Budget.axgrid": JSON.stringify({
    version: 1,
    rows: 100,
    cols: 26,
    cells: {
      A1: "Item",
      B1: "Price",
      C1: "Qty",
      D1: "Total",
      A2: "Notebook",
      B2: "4.5",
      C2: "3",
      D2: "=B2*C2",
      A3: "Pens",
      B3: "1.2",
      C3: "10",
      D3: "=B3*C3",
      A4: "Total",
      D4: "=SUM(D2:D3)",
    },
    widths: { A: 140 },
    formats: { A1: { bold: true }, B1: { bold: true }, C1: { bold: true }, D1: { bold: true } },
  }),
};
