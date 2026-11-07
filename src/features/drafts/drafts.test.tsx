import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { docKind } from "../../lib/fileKinds";
import { DraftBanner } from "./DraftBanner";
import { PAGE_SANDBOX, WebFileView } from "./WebFileView";
import { createDraft, draftName, isDraft, saveDraft, vaultFolders } from "./drafts";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({ "School/Bio.md": "x", "School/Lab/Week1.md": "y" });
  const vault = await h.b.openVault("/v");
  useAppStore.setState({ vault, notice: null, error: null });
  await useAppStore.getState().refreshTree();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe("drafts", () => {
  it("names drafts safely and lists folders", () => {
    expect(draftName('Summarise: "cells" / ATP?')).toBe("Summarise cells ATP");
    expect(draftName("   ")).toBe("AI draft");
    expect(vaultFolders(useAppStore.getState().tree)).toEqual(["", "School", "School/Lab"]);
    expect(docKind("School/Quiz.html")).toBe("web");
  });

  it("writes a draft in the hidden drafts folder and opens it", async () => {
    const path = await createDraft({ title: "Cell notes", content: "# Cells\n", folder: "School" });
    expect(path).toBe(".axisnotes/drafts/Cell notes.md");
    expect(isDraft(path)).toBe(true);
    expect(h.b.files()[path]).toBe("# Cells\n");
    expect(useAppStore.getState().activePath).toBe(path);
    // A second one with the same title gets a free name.
    expect(await createDraft({ title: "Cell notes", content: "", open: false })).toBe(
      ".axisnotes/drafts/Cell notes 1.md",
    );
  });

  it("saves into the folder it was made for, and the tab follows", async () => {
    const path = await createDraft({ title: "Cell notes", content: "# Cells\n", folder: "School" });
    render(<DraftBanner path={path} />);
    expect(screen.getByLabelText("Save to folder")).toHaveValue("School");
    fireEvent.change(screen.getByLabelText("Draft name"), { target: { value: "Cells summary" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(h.b.files()["School/Cells summary.md"]).toBe("# Cells\n"));
    expect(h.b.files()[path]).toBeUndefined();
    expect(useAppStore.getState().activePath).toBe("School/Cells summary.md");
  });

  it("picks a free name when the target exists, and discards to the trash", async () => {
    const a = await createDraft({ title: "Bio", content: "draft", open: false });
    expect(await saveDraft(a, "School", "Bio")).toBe("School/Bio 1.md");
    const b = await createDraft({ title: "Throwaway", content: "z" });
    render(<DraftBanner path={b} />);
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));
    await waitFor(() => expect(h.b.files()[b]).toBeUndefined());
    expect(useAppStore.getState().notice).toMatch(/Draft discarded/);
  });
});

describe("web pages", () => {
  it("shows the page in a sandboxed frame, with the draft banner for drafts", async () => {
    const path = await createDraft({ title: "Quiz", content: "<h1>Quiz</h1>", ext: ".html" });
    vi.spyOn(h.b, "pageUrl").mockImplementation((p) => `http://axispage.localhost/${p}`);
    const open = vi.spyOn(h.b, "openInBrowser").mockResolvedValue();
    render(<WebFileView path={path} />);
    expect(screen.getByRole("region", { name: "Draft" })).toBeInTheDocument();
    const frame = screen.getByTitle("Quiz.html");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe(
      "http://axispage.localhost/.axisnotes/drafts/Quiz.html?r=0",
    );
    // A null origin: no allow-same-origin, and no popups that could escape the sandbox.
    expect(frame.getAttribute("sandbox")).toBe(PAGE_SANDBOX);
    expect(PAGE_SANDBOX).not.toMatch(/same-origin|popups|top-navigation/);
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");

    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(frame.getAttribute("src")).toMatch(/\?r=1$/);
    fireEvent.click(screen.getByRole("button", { name: /Open in browser/ }));
    expect(open).toHaveBeenCalledWith(".axisnotes/drafts/Quiz.html");
  });

  it("reloads when the file changes outside the app", async () => {
    let emit: (c: { kind: "modified"; paths: string[] }[]) => void = () => {};
    vi.spyOn(h.b, "pageUrl").mockImplementation((p) => `http://axispage.localhost/${p}`);
    vi.spyOn(h.b, "onVaultChanged").mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });
    render(<WebFileView path="School/Quiz.html" />);
    const frame = screen.getByTitle("Quiz.html");
    await waitFor(() => expect(h.b.onVaultChanged).toHaveBeenCalled());
    act(() => emit([{ kind: "modified", paths: ["School/Other.html"] }]));
    expect(frame.getAttribute("src")).toMatch(/\?r=0$/);
    act(() => emit([{ kind: "modified", paths: ["School/Quiz.html"] }]));
    expect(frame.getAttribute("src")).toMatch(/\?r=1$/);
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
  });

  it("offers the browser where pages can't be shown in the app", async () => {
    const path = await createDraft({ title: "Quiz", content: "<h1>Quiz</h1>", ext: ".html" });
    const open = vi.spyOn(h.b, "openInBrowser").mockResolvedValue();
    render(<WebFileView path={path} />);
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open in browser/ }));
    expect(open).toHaveBeenCalledWith(".axisnotes/drafts/Quiz.html");
  });

  it("refuses to open anything but a web page", async () => {
    await expect(h.b.openInBrowser("School/Bio.md")).rejects.toMatchObject({ code: "InvalidName" });
  });
});
