import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_BODY_LIMITS, tryReserveApiBodyBytes } from "../src/capture/api-body-capture.js";
import { emptySessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("api body session cap", () => {
  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: true }),
    });
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("reserves bytes until session cap is exceeded", async () => {
    const chunk = API_BODY_LIMITS.perSession - 100;
    expect(await tryReserveApiBodyBytes(chunk)).toBe(true);
    expect(await tryReserveApiBodyBytes(200)).toBe(false);
  });
});
