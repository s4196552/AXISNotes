import type { VaultInfo } from "../ipc";

// Recently opened vaults (this device only; safe to lose), and whether to reopen the
// last one when AXISNotes starts.

const KEY = "axis:recent-vaults";
const REOPEN_KEY = "axis:reopen-last-vault";
const MAX = 8;

export interface RecentVault {
  root: string;
  name: string;
  openedMs: number;
}

function read(): RecentVault[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v)
      ? (v as RecentVault[]).filter((r) => r && typeof r.root === "string")
      : [];
  } catch {
    return [];
  }
}

function write(list: RecentVault[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Not remembered, that's all.
  }
}

export const recentVaults = read;

export function rememberVault(v: VaultInfo) {
  write([
    { root: v.root, name: v.name, openedMs: Date.now() },
    ...read().filter((r) => r.root !== v.root),
  ]);
}

export function forgetVault(root: string) {
  write(read().filter((r) => r.root !== root));
}

export function reopenLast(): boolean {
  try {
    return localStorage.getItem(REOPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setReopenLast(on: boolean) {
  try {
    localStorage.setItem(REOPEN_KEY, String(on));
  } catch {
    // ignore
  }
}

// ---- Getting started, shown once for a new vault ----

const onboardingKey = (root: string) => `axis:getting-started:${root}`;

export function markNewVault(root: string) {
  try {
    localStorage.setItem(onboardingKey(root), "pending");
  } catch {
    // ignore
  }
}

/** True once for a vault created with "Create new vault" (then cleared). */
export function takeGettingStarted(root: string): boolean {
  try {
    const pending = localStorage.getItem(onboardingKey(root)) === "pending";
    if (pending) localStorage.setItem(onboardingKey(root), "shown");
    return pending;
  } catch {
    return false;
  }
}
