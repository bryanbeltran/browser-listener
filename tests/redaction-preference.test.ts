import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import {
  readRedactionPreference,
  setRedactionPreference,
} from "../src/persistence/preferences.js";
import { REDACTED } from "../src/redaction/engine.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("redaction preference", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("defaults to enabled and persists in storage", async () => {
    expect(await readRedactionPreference()).toBe(true);

    await setRedactionPreference(false);
    expect(await readRedactionPreference()).toBe(false);
  });

  it("snapshots persisted preference into new sessions", async () => {
    await setRedactionPreference(false);
    const { createSession } = await import("../src/capture/session-manager.js");

    const session = await createSession(1, "https://example.test/problem");
    expect(session.options.redactionEnabled).toBe(false);
  });

  it("defaults legacy sessions to redaction enabled", async () => {
    const session = sampleSession({ active: false });
    const legacySession = {
      ...session,
      options: { captureBodies: false, captureConsole: true },
    };
    await chrome.storage.local.set({
      browserListenerSessionData: {
        session: legacySession,
        network: [
          {
            id: "legacy-network",
            sessionId: session.id,
            requestId: "legacy-request",
            timestamp: 1,
            url: "https://example.test/api?token=legacy-secret",
            method: "GET",
            type: "fetch",
            responseBody: '{"token":"legacy-secret"}',
          },
        ],
      },
      browserListenerActiveSessionId: null,
    });

    const stored = await readSessionData();
    expect(stored.session?.options.redactionEnabled).toBe(true);
    expect(stored.network[0]?.responseBody).toContain(REDACTED);
    expect(stored.network[0]?.url).not.toContain("legacy-secret");
  });

  it("redacts stored evidence by default", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [
        {
          id: "network-1",
          sessionId: session.id,
          requestId: "request-1",
          timestamp: 1,
          url: "https://example.test/api?access_token=secret",
          method: "GET",
          type: "fetch",
          requestHeaders: { Authorization: "Bearer secret" },
          responseBody: '{"token":"secret"}',
        },
      ],
      console: [
        {
          id: "console-1",
          sessionId: session.id,
          timestamp: 1,
          level: "error",
          text: "token secret",
        },
      ],
    });

    const stored = await readSessionData();
    expect(stored.network[0]?.requestHeaders?.Authorization).toBe(REDACTED);
    expect(stored.network[0]?.responseBody).toContain(REDACTED);
    expect(stored.network[0]?.url).not.toContain("secret");
    expect(stored.console[0]?.text).toBe(REDACTED);
  });

  it("preserves raw evidence after explicit opt-out", async () => {
    await setRedactionPreference(false);
    const session = sampleSession({
      active: true,
      options: { captureBodies: false, captureConsole: true, redactionEnabled: false },
    });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [
        {
          id: "network-raw",
          sessionId: session.id,
          requestId: "request-raw",
          timestamp: 1,
          url: "https://example.test/api?access_token=secret",
          method: "GET",
          type: "fetch",
          requestHeaders: { Authorization: "Bearer secret" },
          responseBody: '{"token":"secret"}',
        },
      ],
    });

    const stored = await readSessionData();
    expect(stored.network[0]?.requestHeaders?.Authorization).toBe("Bearer secret");
    expect(stored.network[0]?.responseBody).toContain("secret");
    expect(stored.network[0]?.url).toContain("secret");
  });

  it("reads persisted preference after module reload", async () => {
    await setRedactionPreference(false);
    vi.resetModules();

    const reloaded = await import("../src/persistence/preferences.js");
    expect(await reloaded.readRedactionPreference()).toBe(false);
  });
});
