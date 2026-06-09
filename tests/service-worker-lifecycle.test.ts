import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

function installSessionStorageMock(): Record<string, unknown> {
  const sessionStore: Record<string, unknown> = {};
  const session = {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return { ...sessionStore };
      const k = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of k) {
        if (key in sessionStore) out[key] = sessionStore[key];
      }
      return out;
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => {
      Object.assign(sessionStore, obj);
    }),
  };
  const local = (globalThis as { chrome: { storage: { local: unknown } } }).chrome.storage.local;
  vi.stubGlobal("chrome", { storage: { local, session } });
  return sessionStore;
}

describe("service worker lifecycle", () => {
  beforeEach(() => {
    installChromeStorageMock();
    installSessionStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
    vi.unstubAllGlobals();
  });

  it("does not mark restart on first SW boot with no active session", async () => {
    const { onServiceWorkerActivate } = await import("../src/background/service-worker-lifecycle.js");
    await onServiceWorkerActivate();
    const { loadRecoverableSession } = await import("../src/persistence/session-recovery.js");
    const { session } = await loadRecoverableSession();
    expect(session).toBeNull();
  });

  it("marks restart only when SW reboots during active capture", async () => {
    await writeSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: true }),
    });
    const { onServiceWorkerActivate } = await import("../src/background/service-worker-lifecycle.js");
    await onServiceWorkerActivate();
    const { loadRecoverableSession } = await import("../src/persistence/session-recovery.js");
    const first = await loadRecoverableSession();
    expect(first.session?.health.serviceWorkerRestarts).toBe(1);

    await onServiceWorkerActivate();
    const second = await loadRecoverableSession();
    expect(second.session?.health.serviceWorkerRestarts).toBe(1);
  });
});
