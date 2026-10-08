import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendConsole,
  appendContextSnapshot,
  appendMarker,
  appendNavigation,
  appendPerformanceSignal,
  emptySessionData,
  readSessionData,
  writeSessionData,
} from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("bounded session evidence", () => {
  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({ ...emptySessionData(), session: sampleSession({ active: true }) });
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("persists navigation and console evidence separately from network", async () => {
    const session = sampleSession({ active: true });
    await appendNavigation({
      id: "nav-1",
      sessionId: session.id,
      timestamp: 1,
      url: "https://example.test/problem?token=secret",
      title: "Problem",
      tabId: session.tabId,
      frameId: 0,
    });
    await appendConsole({
      id: "console-1",
      sessionId: session.id,
      timestamp: 2,
      level: "error",
      text: "token secret-value",
      url: "https://example.test/problem",
      tabId: session.tabId,
    });

    const data = await readSessionData();
    expect(data.network).toHaveLength(0);
    expect(data.navigation).toHaveLength(1);
    expect(data.navigation[0]?.url).not.toContain("secret");
    expect(data.console).toHaveLength(1);
    expect(data.console[0]?.text).toBe("[REDACTED]");
  });

  it("persists bounded user markers and applies the active redaction policy", async () => {
    const session = sampleSession({ active: true });
    await appendMarker({
      id: "marker-1",
      sessionId: session.id,
      timestamp: 3,
      label: "User marker",
      note: "token secret-value",
      url: "https://example.test/problem?token=secret",
      tabId: session.tabId,
    });

    const data = await readSessionData();
    expect(data.markers).toHaveLength(1);
    expect(data.markers?.[0]?.note).toBe("[REDACTED]");
    expect(data.markers?.[0]?.url).not.toContain("secret");
  });

  it("persists low-volume context and performance signals under their own caps", async () => {
    const session = sampleSession({ active: true });
    await appendContextSnapshot({
      id: "context-1",
      sessionId: session.id,
      timestamp: 4,
      tabId: session.tabId,
      url: "https://example.test/problem?token=secret",
      title: "Problem",
      visibilityState: "visible",
      focused: true,
      online: true,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      source: "tabs.get",
    });
    await appendPerformanceSignal({
      id: "performance-1",
      sessionId: session.id,
      timestamp: 5,
      tabId: session.tabId,
      browserSupport: "cdp-performance-v1",
      metrics: { LoadEvent: 1.25 },
    });

    const data = await readSessionData();
    expect(data.contextSnapshots).toHaveLength(1);
    expect(data.contextSnapshots?.[0]?.url).not.toContain("secret");
    expect(data.performanceSignals?.[0]?.metrics).toEqual({ LoadEvent: 1.25 });
  });
});
