import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tryReserveApiBodyBytes } from "../src/capture/api-body-capture.js";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("api body byte accounting", () => {
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

  it("tracks stored bytes without a session cap", async () => {
    expect(await tryReserveApiBodyBytes(5_000_000)).toBe(true);
    expect(await tryReserveApiBodyBytes(5_000_000)).toBe(true);
    const data = await readSessionData();
    expect(data.session?.health.apiBodyBytesStored).toBe(10_000_000);
  });
});
