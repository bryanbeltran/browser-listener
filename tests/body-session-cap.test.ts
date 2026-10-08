import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tryReserveBodyBytes } from "../src/capture/body-capture.js";
import { BODY_CAPTURE_LIMITS } from "../src/persistence/limits.js";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("body capture session cap", () => {
  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({ ...emptySessionData(), session: sampleSession({ active: true }) });
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("tracks bytes and rejects reservations beyond hard session cap", async () => {
    expect(await tryReserveBodyBytes(BODY_CAPTURE_LIMITS.sessionBytes - 10)).toBe(true);
    expect(await tryReserveBodyBytes(11)).toBe(false);
    const data = await readSessionData();
    expect(data.session?.health.bodyBytesStored).toBe(BODY_CAPTURE_LIMITS.sessionBytes - 10);
    expect(data.session?.health.bodiesSkippedSessionCap).toBe(1);
  });
});
