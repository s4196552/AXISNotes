import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { AvailableUpdate } from "../../ipc";
import { UpdateBanner } from "./UpdateBanner";
import { UpdatesSettings } from "./UpdatesSettings";
import { checkOnLaunch, useUpdates } from "./updates";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const UPDATE: AvailableUpdate = {
  version: "0.2.0",
  notes: "Auto-updates",
  pubDate: null,
  file: "AXISNotes_0.2.0_x64-setup.exe",
  verified: true,
  unverifiedReason: null,
};

beforeEach(() => {
  h.b = createMemoryBackend({});
  useUpdates.setState({
    available: null,
    dismissed: false,
    checking: false,
    checked: false,
    installing: false,
    error: null,
  });
});

describe("updates", () => {
  it("checks on launch and offers the update in a banner", async () => {
    h.b.updatesCheck = vi.fn(async () => UPDATE);
    const install = vi.fn(async () => {});
    h.b.updatesInstall = install;
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    const banner = screen.getByRole("region", { name: "Update available" });
    expect(banner).toHaveTextContent("AXISNotes 0.2.0 is available.");
    expect(banner).toHaveTextContent("Auto-updates");
    // This build can't install (like a development build), so nothing is installed
    // until the button is clicked.
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith("0.2.0", false));
    expect(screen.getByText(/Installing/)).toBeInTheDocument();
  });

  it("doesn't check on launch when that is turned off", async () => {
    const check = vi.fn(async () => UPDATE);
    h.b.updatesCheck = check;
    await h.b.updatesSaveSettings(false, true, "");
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    expect(check).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Update available" })).toBeNull();
  });

  it("installs on its own at launch by default when the build can install", async () => {
    const settings = h.b.updatesSettings;
    h.b.updatesSettings = async () => ({ ...(await settings()), canInstall: true });
    h.b.updatesCheck = async () => UPDATE;
    const install = vi.fn(async () => {});
    h.b.updatesInstall = install;
    expect((await h.b.updatesSettings()).autoInstall).toBe(true);
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    expect(install).toHaveBeenCalledWith("0.2.0", false);
    expect(screen.getByRole("region", { name: "Update available" })).toHaveTextContent(
      "Installing… AXISNotes will reopen.",
    );
  });

  it("only offers the update when automatic install is turned off", async () => {
    await h.b.updatesSaveSettings(true, false, "");
    const settings = h.b.updatesSettings;
    h.b.updatesSettings = async () => ({ ...(await settings()), canInstall: true });
    h.b.updatesCheck = async () => UPDATE;
    const install = vi.fn(async () => {});
    h.b.updatesInstall = install;
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
  });

  it("Settings → Updates turns automatic install off, and greys it out without the launch check", async () => {
    render(<UpdatesSettings />);
    const auto = await screen.findByRole("checkbox", { name: "Install updates automatically" });
    expect(auto).toBeChecked();
    expect(auto).toBeEnabled();
    fireEvent.click(auto);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Install updates automatically" }),
      ).not.toBeChecked(),
    );
    expect((await h.b.updatesSettings()).autoInstall).toBe(false);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check for updates when AXISNotes starts" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Install updates automatically" }),
      ).toBeDisabled(),
    );
    // Changing the folder keeps both choices.
    const folder = screen.getByLabelText("Updates folder");
    fireEvent.change(folder, { target: { value: "D:/Builds" } });
    fireEvent.blur(folder);
    await waitFor(async () => expect((await h.b.updatesSettings()).folder).toBe("D:/Builds"));
    const saved = await h.b.updatesSettings();
    expect(saved.checkOnLaunch).toBe(false);
    expect(saved.autoInstall).toBe(false);
  });

  it("keeps launch-time problems quiet", async () => {
    h.b.updatesCheck = async () => {
      throw { code: "Io", message: "network folder is offline" };
    };
    await checkOnLaunch();
    expect(useUpdates.getState().error).toBeNull();
  });

  it("Later hides the banner; an install error is shown", async () => {
    h.b.updatesCheck = async () => UPDATE;
    h.b.updatesInstall = async () => {
      throw { code: "Io", message: "doesn’t match the checksum" };
    };
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("checksum");
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("region", { name: "Update available" })).toBeNull();
  });

  it("Settings → Updates saves the folder and checks on demand", async () => {
    render(<UpdatesSettings />);
    const folder = await screen.findByLabelText("Updates folder");
    expect(folder).toHaveValue("/home/AXISNotes Updates");
    fireEvent.change(folder, { target: { value: "D:/Builds" } });
    fireEvent.blur(folder);
    await waitFor(() => expect(screen.getByLabelText("Updates folder")).toHaveValue("D:/Builds"));
    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Updates folder")).toHaveValue("/home/AXISNotes Updates"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You have the latest version.")).toBeInTheDocument();

    h.b.updatesCheck = async () => UPDATE;
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByRole("button", { name: "Install 0.2.0 and restart" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("AXISNotes 0.2.0 is available.");
  });

  // T-282: an update whose manifest isn't signed by the release key.
  const UNVERIFIED: AvailableUpdate = {
    ...UPDATE,
    verified: false,
    unverifiedReason: "The updates folder has no signature (latest.json.sig).",
  };

  it("never installs an unverified update at launch, even with automatic install on", async () => {
    const settings = h.b.updatesSettings;
    h.b.updatesSettings = async () => ({ ...(await settings()), canInstall: true });
    h.b.updatesCheck = async () => UNVERIFIED;
    const install = vi.fn(async () => {});
    h.b.updatesInstall = install;
    expect((await h.b.updatesSettings()).autoInstall).toBe(true);
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    expect(install).not.toHaveBeenCalled();
    // A direct call without the user's choice doesn't install it either.
    await act(() => useUpdates.getState().install());
    expect(install).not.toHaveBeenCalled();

    const banner = screen.getByRole("region", { name: "Update available" });
    expect(banner).toHaveTextContent("Not verified: The updates folder has no signature");
    expect(screen.queryByRole("button", { name: "Install and restart" })).toBeNull();
    // Chosen by the user, it installs, and the backend is told it may be unverified.
    fireEvent.click(screen.getByRole("button", { name: "Install anyway" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith("0.2.0", true));
  });

  it("asks the backend for a verified install when the update was shown as verified", async () => {
    h.b.updatesCheck = async () => UPDATE;
    const install = vi.fn(async () => {});
    h.b.updatesInstall = install;
    render(<UpdateBanner />);
    await act(() => checkOnLaunch());
    expect(screen.queryByText(/Not verified/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    // If the folder changed to an unverified manifest since the check, Rust refuses it.
    await waitFor(() => expect(install).toHaveBeenCalledWith("0.2.0", false));
  });

  it("Settings → Updates marks an unverified update", async () => {
    h.b.updatesCheck = async () => UNVERIFIED;
    render(<UpdatesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("button", { name: "Install 0.2.0 anyway" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not verified");
  });
});
