import { afterEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { resetNetworkStoreCacheForTests } from "../src/persistence/network-store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

type DebuggerMocks = {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
};

function installChromeWithDebugger(): DebuggerMocks {
  installChromeStorageMock();
  const attach = vi.fn(async () => {});
  const detach = vi.fn(async () => {});
  const sendCommand = vi.fn(async () => ({}));
  const existing = (globalThis as { chrome?: { storage?: unknown } }).chrome;
  vi.stubGlobal("chrome", {
    ...existing,
    storage: existing?.storage,
    debugger: {
      attach,
      detach,
      sendCommand,
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
    },
  });
  return { attach, detach, sendCommand };
}

describe("attachDebugger", () => {
  afterEach(async () => {
    try {
      const store = await import("../src/persistence/store.js");
      await store.flushPopupSnapshot();
      await store.resetNetworkStoreForTests();
    } catch {
      /* store not loaded */
    }
    try {
      const mod = await import("../src/capture/debugger-capture.js");
      mod.resetDebuggerCaptureForTests();
    } catch {
      /* module not loaded */
    }
    resetNetworkStoreCacheForTests();
    uninstallChromeStorageMock();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("records attach failure gap and detaches when Network.enable fails", async () => {
    const { attach, detach, sendCommand } = installChromeWithDebugger();
    const session = sampleSession({ active: true, tabId: 42 });
    await writeSessionData({ ...emptySessionData(), session });

    sendCommand.mockRejectedValueOnce(new Error("Network.enable failed"));

    const { attachDebugger } = await import("../src/capture/debugger-capture.js");
    await expect(attachDebugger(42)).rejects.toThrow("Network.enable failed");

    expect(attach).toHaveBeenCalledWith({ tabId: 42 }, "1.3");
    expect(detach).toHaveBeenCalledWith({ tabId: 42 });

    const data = await readSessionData();
    expect(data.session?.health.debuggerAttached).toBe(false);
    expect(data.session?.health.lastAttachError).toBe("Network.enable failed");
    expect(
      data.session?.health.partialGaps.some((g) =>
        g.reason.startsWith("debugger_attach_failed: Network.enable failed"),
      ),
    ).toBe(true);

    const { snapshotDebuggerHealthForExport } = await import("../src/capture/debugger-capture.js");
    await snapshotDebuggerHealthForExport();
    const exported = await readSessionData();
    expect(
      exported.session?.health.partialGaps.some((g) =>
        g.reason.startsWith("capture_without_debugger:"),
      ),
    ).toBe(true);
  });

  it("marks debuggerEverAttached and snapshots health for export", async () => {
    installChromeWithDebugger();
    const session = sampleSession({ active: true, tabId: 7 });
    await writeSessionData({ ...emptySessionData(), session });

    const mod = await import("../src/capture/debugger-capture.js");
    await mod.attachDebugger(7);
    await mod.snapshotDebuggerHealthForExport();

    const data = await readSessionData();
    expect(data.session?.health.debuggerAttached).toBe(true);
    expect(data.session?.health.debuggerEverAttached).toBe(true);
  });

  it("attaches every selected target while keeping a secondary gap non-fatal", async () => {
    const { attach, sendCommand } = installChromeWithDebugger();
    const session = sampleSession({
      active: true,
      tabId: 42,
      targets: [
        { tabId: 42, url: "https://example.test/primary", partialGaps: [] },
        { tabId: 43, url: "https://example.test/secondary", partialGaps: [] },
      ],
    });
    await writeSessionData({ ...emptySessionData(), session });

    attach.mockImplementation(async ({ tabId }: { tabId: number }) => {
      if (tabId === 43) throw new Error("secondary unavailable");
    });

    const mod = await import("../src/capture/debugger-capture.js");
    await mod.ensureDebuggerForSession();

    expect(attach).toHaveBeenCalledWith({ tabId: 42 }, "1.3");
    expect(attach).toHaveBeenCalledWith({ tabId: 43 }, "1.3");
    expect(mod.getAttachedTabIds()).toEqual([42]);
    expect(sendCommand).toHaveBeenCalled();

    const data = await readSessionData();
    expect(data.session?.health.debuggerAttached).toBe(true);
    expect(data.session?.targets?.find((target) => target.tabId === 42)?.debuggerAttached).toBe(true);
    expect(data.session?.targets?.find((target) => target.tabId === 43)?.debuggerAttached).toBe(false);
    expect(data.session?.targets?.find((target) => target.tabId === 43)?.partialGaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "debugger_attach_failed" })]),
    );
  });
});
