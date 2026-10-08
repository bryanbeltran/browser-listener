import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptySessionData,
  readPopupStateForUi,
  readPopupStateSnapshot,
  writeSessionData,
} from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session start", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("writes popup snapshot immediately when capture is activated", async () => {
    const { createSession, activateCaptureSession } = await import("../src/capture/session-manager.js");
    await createSession(42, "https://example.test/problem", {});
    let snapshot = await readPopupStateSnapshot();
    expect(snapshot.session?.active).toBe(false);

    await activateCaptureSession();
    snapshot = await readPopupStateSnapshot();
    expect(snapshot.session?.active).toBe(true);
    expect(snapshot.counts.network).toBe(0);
  });

  it("reconciles UI when session meta is active but popup snapshot is stale", async () => {
    const session = sampleSession({ active: true, id: "stale-ui-session" });
    await chrome.storage.local.set({
      browserListenerSessionData: { session },
      browserListenerActiveSessionId: session.id,
      browserListenerPopupState: {
        session: null,
        counts: { network: 0 },
        canExport: false,
      },
    });

    const ui = await readPopupStateForUi();
    expect(ui.session?.active).toBe(true);
    expect(ui.session?.id).toBe(session.id);
    expect(ui.canExport).toBe(false);
  });

  it("reconciles stale debugger health from session meta", async () => {
    const session = sampleSession({
      active: true,
      id: "health-stale",
      health: {
        ...sampleSession().health,
        debuggerAttached: true,
        debuggerEverAttached: true,
      },
    });
    await chrome.storage.local.set({
      browserListenerSessionData: { session },
      browserListenerActiveSessionId: session.id,
      browserListenerPopupState: {
        session: {
          id: session.id,
          active: true,
          startedAt: session.startedAt,
          health: {
            debuggerAttached: false,
            debuggerEverAttached: false,
            partialGaps: [],
            truncation: { network: 0 },
          },
        },
        counts: { network: 5 },
        canExport: false,
      },
    });

    const ui = await readPopupStateForUi();
    expect(ui.session?.health?.debuggerAttached).toBe(true);
  });

  it("allows start when a stale active session exists in storage", async () => {
    const session = sampleSession({ active: true, id: "zombie-session" });
    await chrome.storage.local.set({
      browserListenerSessionData: { session },
      browserListenerActiveSessionId: session.id,
    });

    const { createSession, activateCaptureSession } = await import("../src/capture/session-manager.js");
    const next = await createSession(7, "https://example.test/next-problem", {});
    await activateCaptureSession();

    expect(next.id).not.toBe(session.id);
    const ui = await readPopupStateForUi();
    expect(ui.session?.active).toBe(true);
    expect(ui.session?.id).toBe(next.id);
  });

  it("snapshots an origin allowlist into the capture policy", async () => {
    const { createSession } = await import("../src/capture/session-manager.js");
    const session = await createSession(7, "https://example.test/problem", {
      allowedOrigins: ["https://example.test/"],
    });
    expect(session.options.allowedOrigins).toEqual(["https://example.test"]);
    expect(session.policyEpochs).toHaveLength(1);
    expect(session.policyEpochs?.[0]).toMatchObject({
      profile: "network-console",
      redactionEnabled: true,
      allowedOrigins: ["https://example.test"],
      budgets: {
        perOriginBytes: 32 * 1024 * 1024,
        perCategoryBytes: 64 * 1024 * 1024,
      },
    });
  });

  it("rejects malformed origin policy before clearing existing evidence", async () => {
    const { createSession } = await import("../src/capture/session-manager.js");
    await expect(
      createSession(7, "https://example.test/problem", { allowedOrigins: ["file:///tmp"] }),
    ).rejects.toThrow("exact HTTP(S) origin");
  });

  it("records pause intervals and rejects pause requests without an active session", async () => {
    const { pauseCapture, resumeCapture } = await import("../src/capture/session-manager.js");
    expect(await pauseCapture()).toBeNull();
    expect(await resumeCapture()).toBeNull();

    const session = sampleSession({ active: true, paused: false, pauseIntervals: [] });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: session.id });

    const paused = await pauseCapture();
    expect(paused?.paused).toBe(true);
    expect(paused?.pauseIntervals).toHaveLength(1);
    expect(paused?.pauseIntervals?.[0]?.endedAt).toBeUndefined();

    const resumed = await resumeCapture();
    expect(resumed?.paused).toBe(false);
    expect(resumed?.pauseIntervals?.[0]?.endedAt).toBeTypeOf("number");
    expect(resumed?.pauseIntervals?.[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
