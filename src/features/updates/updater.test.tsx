import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdaterWindow } from "./UpdaterWindow";
import { updaterSteps } from "./updaterSteps";

const job = { fromVersion: "0.3.19", toVersion: "0.3.20", notes: "Zoom what you point at" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(updaterSteps, "job").mockResolvedValue(job);
  vi.spyOn(updaterSteps, "finish").mockResolvedValue();
});

describe("the update window", () => {
  it("installs, then opens the updated app", async () => {
    let done!: () => void;
    const install = vi
      .spyOn(updaterSteps, "install")
      .mockReturnValue(new Promise<void>((r) => (done = r)));
    render(<UpdaterWindow delayMs={0} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Updating AXISNotes");
    expect(await screen.findByText("0.3.20")).toBeInTheDocument();
    expect(screen.getByText("Zoom what you point at")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Installing"));
    expect(updaterSteps.finish).not.toHaveBeenCalled();
    done();
    await waitFor(() => expect(updaterSteps.finish).toHaveBeenCalledWith(true));
    expect(screen.getByRole("status")).toHaveTextContent("Opening AXISNotes");
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("says when the installer fails, and offers to open AXISNotes or close", async () => {
    vi.spyOn(updaterSteps, "install").mockRejectedValue({
      code: "Io",
      message: "The installer stopped with error 2.",
    });
    render(<UpdaterWindow delayMs={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The installer stopped with error 2. Your notes are safe",
    );
    expect(screen.getByRole("heading")).toHaveTextContent("The update didn’t install");
    expect(updaterSteps.finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(updaterSteps.finish).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Open AXISNotes" }));
    expect(updaterSteps.finish).toHaveBeenCalledWith(true);
  });
});
