import { $, browser } from "@wdio/globals";

/**
 * The open note's title as the user sees it. Since T-107 a note's title is an editable
 * `input.editor-title` (its text is the value, not the element's text); a daily note shows
 * its date in an `h1.editor-title` instead.
 */
export async function noteTitle(): Promise<string> {
  const el = await $(".editor-title");
  if (!(await el.isExisting())) return "";
  return (await el.getTagName()) === "input" ? el.getValue() : el.getText();
}

/** Wait until the open note's title reads `name`, reporting the last title on timeout. */
export async function expectNoteTitle(name: string, timeout?: number): Promise<void> {
  let last = "";
  try {
    await browser.waitUntil(async () => (last = await noteTitle()) === name, { timeout });
  } catch {
    throw new Error(`expected the note title ${JSON.stringify(name)}, got ${JSON.stringify(last)}`);
  }
}
