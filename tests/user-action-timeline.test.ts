import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userActionTimelineSummary } from "../src/background/sender-context.js";
import { recordTimeline } from "../src/capture/timeline.js";
import {
  appendUserAction,
  emptySessionData,
  readSessionData,
  writeSessionData,
} from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("user actions in timeline", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("timeline includes user action events with frame context", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });

    const action = {
      id: "ua-1",
      sessionId: session.id,
      timestamp: Date.now(),
      type: "click" as const,
      target: "button#go",
      url: "https://example.com",
      frameId: "12",
      tabId: 1,
    };
    await appendUserAction(action);
    await recordTimeline(session.id, "user", action.type, userActionTimelineSummary(action), {
      frameId: action.frameId,
      tabId: action.tabId,
      payloadRef: action.id,
    });

    const data = await readSessionData();
    expect(data.userActions.length).toBe(1);
    const evt = data.timeline.find((e) => e.category === "user");
    expect(evt?.type).toBe("click");
    expect(evt?.frameId).toBe("12");
    expect(evt?.summary).toContain("button#go");
  });
});
