import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { COPYABLE_MARK, COPYABLE_RULE, makeCopyable, pageText } from "./copyable";
import { extractHtml, parseSkill, parseSkillFiles, skillSystem, withFormat } from "./skills";
import { PageResult } from "./SkillResult";
import { WebFileView } from "../drafts/WebFileView";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const writeText = vi.fn(async (_text: string) => {});
beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

const PAGE = "<!doctype html>\n<html><head><title>Cards</title></head><body>Hi</body></html>\n";

describe("makeCopyable", () => {
  it("puts the guard first in <head>, once", () => {
    const out = makeCopyable(PAGE);
    expect(out.indexOf(COPYABLE_MARK)).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf(COPYABLE_MARK)).toBeLessThan(out.indexOf("<title>"));
    expect(out).toMatch(/user-select:text!important/);
    expect(makeCopyable(out)).toBe(out);
    expect(out.replace(/\n?<style data-axisnotes-copyable>.*<\/script>\n/s, "")).toBe(PAGE);
  });

  it("adds a <head> to a page without one, and copes with no <html> at all", () => {
    const noHead = makeCopyable("<!doctype html><html lang='en'><body>x</body></html>");
    expect(noHead).toMatch(/^<!doctype html><html lang='en'>\n<head>\n<style data-axisnotes/);
    expect(noHead).toMatch(/<\/script>\n<\/head><body>x/);
    const bare = makeCopyable("<!doctype html><p>x</p>");
    expect(bare).toMatch(/^<!doctype html>\n<style data-axisnotes/);
  });

  it("is on every page a skill makes, and only on pages", () => {
    expect(extractHtml("```html\n" + PAGE + "```")).toContain(COPYABLE_MARK);
    const files = parseSkillFiles(
      JSON.stringify({
        files: [
          { path: "Lesson 1.html", content: PAGE },
          { path: "Lesson 1.md", content: "# Lesson" },
        ],
      }),
    ).files;
    expect(files[0]!.content).toContain(COPYABLE_MARK);
    expect(files[1]!.content).toBe("# Lesson\n");
  });

  it("page-making runs are told to keep text copyable; note-making runs aren't", () => {
    const own = parseSkill(
      ["---", "name: sum", "output: markdown", "---", "Summarise."].join("\n"),
      "Skills/sum/SKILL.md",
    )!;
    expect(skillSystem(withFormat(own, "html"))).toContain(COPYABLE_RULE);
    expect(skillSystem(withFormat(own, "markdown"))).not.toContain(COPYABLE_RULE);
  });
});

describe("the guard, running in a page", () => {
  // Run the guard's script here, as the browser would on opening the page.
  const script = /<script data-axisnotes-copyable>([\s\S]*?)<\/script>/.exec(
    makeCopyable(PAGE),
  )![1]!;
  new Function(script)();
  const cleanup: (() => void)[] = [];
  const on = (t: string, f: (e: Event) => void) => {
    document.addEventListener(t, f);
    cleanup.push(() => document.removeEventListener(t, f));
  };
  afterEach(() => {
    cleanup.splice(0).forEach((f) => f());
    document.body.innerHTML = "";
    getSelection()?.removeAllRanges();
  });

  it("the page can't cancel copy, cut, paste, select or the right-click menu", () => {
    for (const t of ["copy", "cut", "paste", "selectstart", "contextmenu"]) {
      on(t, (e) => e.preventDefault());
      const e = new Event(t, { bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      expect(e.defaultPrevented, t).toBe(false);
    }
  });

  it("nor Ctrl+C / Ctrl+V; other keys still reach the page", () => {
    const keys: string[] = [];
    on("keydown", (e) => {
      keys.push((e as KeyboardEvent).key);
      e.preventDefault();
    });
    const press = (key: string, ctrlKey = true) => {
      const e = new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press("c")).toBe(false);
    expect(press("v")).toBe(false);
    expect(press("ArrowRight", false)).toBe(true);
    expect(keys).toEqual(["ArrowRight"]);
  });

  it("a click that ends a selection doesn't flip a card; other clicks do", () => {
    document.body.innerHTML = `<div class="card">Mitochondria</div><button>Next</button>`;
    const flips: string[] = [];
    on("click", (e) => flips.push((e.target as Element).tagName));
    const card = document.querySelector(".card")!;
    const select = () => {
      const r = document.createRange();
      r.selectNodeContents(card);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    };
    select();
    fireEvent.click(card);
    expect(flips).toEqual([]);
    fireEvent.click(document.querySelector("button")!); // a control still works
    getSelection()!.removeAllRanges();
    fireEvent.click(card); // a plain click flips
    expect(flips).toEqual(["BUTTON", "DIV"]);
  });
});

describe("Copy text", () => {
  it("is the page's text, a block per line, without its scripts or styles", () => {
    const html =
      "<html><head><style>p{}</style></head><body><h1>Cells</h1><p>The <b>cell</b> is\n  the unit.</p>" +
      "<ul><li>Nucleus</li><li>Ribosome</li></ul><table><tr><td>A</td><td>B</td></tr></table>" +
      "<script>document.write('x')</script></body></html>";
    expect(pageText(html)).toBe("Cells\n\nThe cell is the unit.\n\nNucleus\nRibosome\n\nA\tB");
    expect(pageText("<html><body><div id=app></div><script>render()</script></body></html>")).toBe(
      "",
    );
  });

  it("copies from a skill's result", async () => {
    const notify = vi.spyOn(useAppStore.getState(), "notify");
    const skill = parseSkill(
      ["---", "name: cards", "output: html", "---", "Cards."].join("\n"),
      "Skills/cards/SKILL.md",
    )!;
    render(
      <PageResult
        skill={skill}
        html={makeCopyable("<!doctype html><html><body><p>One</p><p>Two</p></body></html>")}
        path="Bio/Cells.md"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("One\n\nTwo"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Copied the page's text (2 lines)."));
    notify.mockRestore();
  });

  it("copies from a web page in the vault, or says why it can't", async () => {
    const notify = vi.spyOn(useAppStore.getState(), "notify");
    await h.b.writeFile("Bio/Quiz.html", "<html><body><h1>Quiz</h1></body></html>");
    await h.b.writeFile("Bio/App.html", "<html><body><script>go()</script></body></html>");
    const { unmount } = render(<WebFileView path="Bio/Quiz.html" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Quiz"));
    unmount();
    render(<WebFileView path="Bio/App.html" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy text/ }));
    await waitFor(() =>
      expect(notify).toHaveBeenLastCalledWith(
        expect.stringMatching(/writes its text when it runs/),
      ),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    notify.mockRestore();
  });
});
