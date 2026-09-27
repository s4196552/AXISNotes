// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://bio.example.com/articles/cells"}
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractPage } from "./extract.js";
import { deliver, flush, newClip, pair, QUEUE_KEY, queued, sendClip, status } from "./queue.js";

beforeAll(() => {
  globalThis.Readability = Readability;
  globalThis.TurndownService = TurndownService;
  globalThis.turndownPluginGfm = { gfm };
});

const ARTICLE = `
  <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
  <main><article>
    <h1>How Cells Work</h1>
    <p>Cells are the <strong>basic unit</strong> of life. Every living thing is made of cells,
    from bacteria to blue whales. This paragraph is long enough for Readability to keep it,
    so it keeps going with more words about membranes, organelles and energy.</p>
    <h2>Parts</h2>
    <ul><li>Nucleus</li><li>Mitochondria, see <a href="/mito">the mitochondria page</a></li></ul>
    <p>Organelles do the work: mitochondria make ATP, ribosomes build proteins, and the
    endoplasmic reticulum folds and ships them where they need to go in the cell.</p>
    <table><thead><tr><th>Part</th><th>Job</th></tr></thead>
    <tbody><tr><td>Nucleus</td><td>Stores DNA</td></tr></tbody></table>
    <img src="/img/cell.png" alt="A cell">
  </article></main>
  <footer>© 2026 Bio Example · <a href="/privacy">Privacy</a></footer>
  <script>tracking()</script>`;

describe("page extraction (runs in the page)", () => {
  beforeEach(() => {
    document.title = "How Cells Work | Bio Example";
    document.body.innerHTML = ARTICLE;
  });

  it("keeps the article as Markdown with absolute links, without navigation", () => {
    const r = extractPage("page");
    expect(r.url).toBe("https://bio.example.com/articles/cells");
    expect(r.title).toMatch(/How Cells Work/);
    expect(r.markdown).toContain("Cells are the **basic unit** of life.");
    expect(r.markdown).toContain("## Parts");
    expect(r.markdown).toMatch(/^- Nucleus$/m);
    expect(r.markdown).toContain("[the mitochondria page](https://bio.example.com/mito)");
    expect(r.markdown).toContain("| Part | Job |");
    expect(r.markdown).toContain("![A cell](https://bio.example.com/img/cell.png)");
    expect(r.markdown).not.toContain("Privacy");
    expect(r.markdown).not.toContain("tracking()");
    expect(r.markdown.startsWith("# How Cells Work")).toBe(false); // the note has its own title
    // The page itself is left alone.
    expect(document.querySelector('a[href="/mito"]')).not.toBeNull();
  });

  it("converts only the selection", () => {
    const strong = document.querySelector("strong");
    const range = document.createRange();
    range.selectNodeContents(strong.parentElement);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const r = extractPage("selection");
    expect(r.markdown.startsWith("Cells are the **basic unit** of life.")).toBe(true);
    expect(r.markdown).not.toContain("Parts");
    window.getSelection().removeAllRanges();
    expect(extractPage("selection").markdown).toBe("");
  });
});

function memoryStorage() {
  const data = new Map();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, JSON.parse(JSON.stringify(v))),
  };
}

/** A fake AXISNotes: `up` switches it on and off; records what it received. */
function fakeAxis() {
  const axis = { up: true, received: [], status: 201 };
  axis.fetch = async (url, init = {}) => {
    if (!axis.up) throw new TypeError("Failed to fetch");
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith("/clip")) {
      if (init.headers.Authorization !== "Bearer t0k3n") return new Response("{}", { status: 401 });
      axis.received.push(body);
      return new Response(JSON.stringify({ error: "bad clip" }), { status: axis.status });
    }
    if (url.endsWith("/pair"))
      return body.code === "123456"
        ? Response.json({ token: "t0k3n" })
        : Response.json({ error: "wrong pairing code" }, { status: 403 });
    if (url.endsWith("/status"))
      return Response.json({ paired: init.headers?.Authorization === "Bearer t0k3n", vault: true });
    return new Response("", { status: 404 });
  };
  return axis;
}

describe("delivery and the offline queue", () => {
  it("sends clips straight away when AXISNotes is running", async () => {
    const axis = fakeAxis();
    const env = { fetch: axis.fetch, storage: memoryStorage(), token: "t0k3n" };
    const clip = newClip("url", { title: "T", url: "https://x.io" });
    expect(await deliver(clip, env)).toBe("sent");
    expect(axis.received).toEqual([clip]);
    expect(await queued(env.storage)).toEqual([]);
  });

  it("queues clips while AXISNotes is closed and sends them later, in order, once", async () => {
    const axis = fakeAxis();
    const env = { fetch: axis.fetch, storage: memoryStorage(), token: "t0k3n" };
    axis.up = false;
    const a = newClip("url", { title: "A", url: "https://a.io" });
    const b = newClip("selection", { title: "B", url: "https://b.io", markdown: "quote" });
    expect(await deliver(a, env)).toBe("retry");
    expect(await deliver(b, env)).toBe("retry");
    expect(await deliver(a, env)).toBe("retry"); // same clip again: not queued twice
    expect((await queued(env.storage)).map((c) => c.title)).toEqual(["A", "B"]);
    expect(await flush(env)).toEqual({ sent: 0, left: 2, errors: [] });

    axis.up = true;
    expect(await flush(env)).toEqual({ sent: 2, left: 0, errors: [] });
    expect(axis.received.map((c) => c.title)).toEqual(["A", "B"]);
    expect(env.storage.data.get(QUEUE_KEY)).toEqual([]);
  });

  it("keeps clips until the browser is paired, and drops ones AXISNotes rejects", async () => {
    const axis = fakeAxis();
    const env = { fetch: axis.fetch, storage: memoryStorage(), token: null };
    expect(await deliver(newClip("url", { url: "https://x.io" }), env)).toBe("unpaired");
    expect(await queued(env.storage)).toHaveLength(1);

    expect(await pair("000000", "Chrome", env)).toEqual({ error: "wrong pairing code" });
    const { token } = await pair(" 123456 ", "Chrome", env);
    env.token = token;
    axis.status = 400;
    expect(await flush(env)).toEqual({ sent: 0, left: 0, errors: ["bad clip"] });
    expect(await sendClip(newClip("url", {}), env)).toEqual({ error: "bad clip" });
  });

  it("reports status for the popup", async () => {
    const axis = fakeAxis();
    const env = { fetch: axis.fetch, storage: memoryStorage(), token: "t0k3n" };
    expect(await status(env)).toEqual({ running: true, paired: true, vault: true, queue: 0 });
    axis.up = false;
    expect(await status(env)).toEqual({ running: false, paired: true, vault: false, queue: 0 });
  });
});
