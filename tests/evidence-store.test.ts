import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendConsole,
  appendNavigation,
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
});
