import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnswerText } from "./AnswerText";

const h = vi.hoisted(() => ({ followLink: vi.fn() }));
vi.mock("../commands/actions", () => ({ followLink: h.followLink }));

describe("Markdown answers", () => {
  it("renders nested lists, tasks, headings and inline styles as note blocks", () => {
    const { container } = render(
      <AnswerText
        from="Bio.md"
        text={
          "## Cells\n\n- **Energy**\n  - ==ATP and *fuel*==\n\n3. Read\n4. Recall\n\n- [ ] Study\n- [x] Done\n\n> A quote\n\n---"
        }
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Cells");
    expect(container.querySelector("ul ul mark em")).toHaveTextContent("fuel");
    expect(container.querySelector("ol")).toHaveAttribute("start", "3");
    expect(screen.getByRole("checkbox", { name: "Task" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Completed task" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Completed task" })).toBeDisabled();
    expect(container.querySelector("blockquote")).toHaveTextContent("A quote");
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("renders tables with alignment, escaped pipes and note aliases without losing cells", () => {
    const { container } = render(
      <AnswerText
        from="School/Bio.md"
        text={"| Topic | Details |\n| :--- | ---: |\n| [[Bio|Cells]] | **ATP** and a\\|b |"}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("cell")).toHaveLength(2);
    expect(screen.getAllByRole("cell")[1]).toHaveStyle({ textAlign: "right" });
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("ATP and a|b");
    expect(container.querySelector("td strong")).toHaveTextContent("ATP");
    fireEvent.click(screen.getByRole("button", { name: "Cells" }));
    expect(h.followLink).toHaveBeenLastCalledWith("Bio|Cells", "School/Bio.md", { newTab: false });
  });

  it("uses AXISNotes callout kinds and keeps collapsed bodies available on demand", () => {
    const { container } = render(
      <AnswerText
        from="Bio.md"
        text={
          "> [!warning] **Remember**\n> ==Keep this==\n\n> [!tip]- Try recall\n> Hidden answer\n>\n> - Nested point"
        }
      />,
    );
    expect(container.querySelector(".answer-callout-warning strong")).toHaveTextContent("Remember");
    expect(container.querySelector("aside mark")).toHaveTextContent("Keep this");
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Hidden answer")).not.toBeVisible();
    fireEvent.click(screen.getByText("Try recall"));
    expect(screen.getByText("Hidden answer")).toBeVisible();
    expect(details.querySelector("li")).toHaveTextContent("Nested point");
  });

  it("preserves open fences while streaming and never interprets code, HTML or media", () => {
    const { container, rerender } = render(
      <AnswerText from="Bio.md" text={"```green\n==literal==\n\n[[Not a link]]"} />,
    );
    expect(container.querySelector("pre")).toHaveAttribute("data-code-color", "green");
    expect(container.querySelector("pre code")).toHaveTextContent("==literal==");
    expect(container.querySelector("pre code")!.textContent).toBe("==literal==\n\n[[Not a link]]");
    expect(container.querySelector("button, mark")).toBeNull();
    rerender(
      <AnswerText
        from="Bio.md"
        text={
          '<script>alert(1)</script>\n\n<img src="https://example.com/track">\n\n![remote](https://example.com/pixel)\n\n`==literal==`\n\n[bad](javascript:alert)'
        }
      />,
    );
    expect(container.querySelector("script, img, iframe, a, mark")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container.querySelector("code")).toHaveTextContent("==literal==");
  });

  it("keeps citation validation and middle-click navigation in rich blocks", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <AnswerText
        from="Bio.md"
        text={"> [!note] Sources\n> ==[[Bio|Known]]== and [[Other|Unknown]]"}
        isKnown={(inner) => inner.startsWith("Bio")}
        onFollow={onFollow}
      />,
    );
    expect(container.querySelector(".cite-unknown")).toHaveTextContent("Unknown");
    fireEvent(
      screen.getByRole("button", { name: "Known" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(h.followLink).toHaveBeenLastCalledWith("Bio|Known", "Bio.md", { newTab: true });
    fireEvent.click(screen.getByRole("button", { name: "Known" }));
    expect(onFollow).toHaveBeenCalled();
  });
});
