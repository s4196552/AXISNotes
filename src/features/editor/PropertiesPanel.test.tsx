import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropertiesPanel } from "./PropertiesPanel";

describe("PropertiesPanel", () => {
  it("shows computed results next to formula properties", () => {
    const onChange = vi.fn();
    render(
      <PropertiesPanel
        props={{ price: 3, qty: 4, total: "=price*qty", broken: "=1/0" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("Type of total")).toHaveValue("formula");
    expect(screen.getByLabelText("Result of total")).toHaveTextContent("= 12");
    expect(screen.getByLabelText("Result of broken")).toHaveTextContent("#DIV/0!");

    fireEvent.change(screen.getByLabelText("Type of qty"), { target: { value: "formula" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ qty: "=4" }));
  });

  it("shows structured values read-only instead of mangling them", () => {
    render(
      <PropertiesPanel
        props={{ time_log: [{ start: "2026-09-26T10:00:00" }, { start: "2026-09-26T12:00:00" }] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Value of time_log")).toHaveTextContent("2 entries");
    expect(screen.getByLabelText("Type of time_log")).toBeDisabled();
  });
});
