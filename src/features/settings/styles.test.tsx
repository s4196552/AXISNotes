import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "./Settings";

// T-277: Settings → Appearance → Styles.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

const config = () => useConfig.getState().config;
const card = (name: string) => screen.getByRole("button", { name: `${name} style` });

describe("Styles tab (T-277)", () => {
  it("is the first tab of Appearance", () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toBe("Styles");
    expect(tabs[1]).toBe("Theme & layout");
  });

  it("applies a Style in one click, marks it, and can undo it", async () => {
    useConfig.setState({
      config: {
        ...structuredClone(DEFAULT_CONFIG),
        theme: "dark",
        appearance: { ...DEFAULT_CONFIG.appearance, noteFont: "Arial", noteFontSize: 20 },
      },
    });
    render(<Settings section="styles" onClose={vi.fn()} />);
    expect(card("AXIS Default")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card("Paper & Ink"));
    await waitFor(() => expect(config().theme).toBe("light"));
    expect(config().appearance).toMatchObject({
      noteFont: "Georgia",
      noteFontSize: 16,
      headingColors: "amber",
    });
    expect(card("Paper & Ink")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Applied Paper & Ink.");
    await waitFor(async () =>
      expect(JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).theme).toBe(
        "light",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(config().theme).toBe("dark"));
    expect(config().appearance).toMatchObject({ noteFont: "Arial", noteFontSize: 20 });
    expect(card("Paper & Ink")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("saves the current look, renames it and deletes it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Settings section="styles" onClose={vi.fn()} />);
    fireEvent.click(card("Midnight"));
    fireEvent.click(screen.getByRole("button", { name: "Save current look as a style…" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: " Night owl " } });
    fireEvent.click(save);
    await waitFor(() => expect(config().styles.map((s) => s.name)).toEqual(["Night owl"]));
    expect(config().styles[0]).toMatchObject({
      theme: "dark",
      look: { headingColors: "ocean" },
    });
    // It matches the look in use, like Midnight, which is listed first.
    expect(card("Midnight")).toHaveAttribute("aria-pressed", "true");

    // The same name again replaces it, after asking.
    fireEvent.click(card("Paper & Ink"));
    fireEvent.click(screen.getByRole("button", { name: "Save current look as a style…" }));
    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: "night OWL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringMatching(/Replace your style “Night owl”/),
    );
    await waitFor(() => expect(config().styles).toHaveLength(1));
    expect(config().styles[0]).toMatchObject({ name: "night OWL", theme: "light" });

    fireEvent.click(screen.getByRole("button", { name: "Rename night OWL" }));
    const field = screen.getByLabelText("New name for night OWL");
    fireEvent.change(field, { target: { value: "Reading" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(config().styles.map((s) => s.name)).toEqual(["Reading"]));

    // Applying your own Style works like a built-in one.
    fireEvent.click(card("Midnight"));
    await waitFor(() => expect(config().theme).toBe("dark"));
    fireEvent.click(card("Reading"));
    await waitFor(() => expect(config().theme).toBe("light"));

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete Reading" }));
    expect(config().styles).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Reading" }));
    await waitFor(() => expect(config().styles).toEqual([]));
    // Deleting a Style keeps the look.
    expect(config().theme).toBe("light");
    expect(within(document.body).queryByRole("button", { name: "Reading style" })).toBeNull();
  });
});
