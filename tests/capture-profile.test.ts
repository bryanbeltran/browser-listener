import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureProfileDefaults,
  inferCaptureProfile,
} from "../src/shared/types.js";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("capture profiles", () => {
  beforeEach(() => installChromeStorageMock());
  afterEach(() => uninstallChromeStorageMock());

  it("maps named profiles to bounded capture behavior", () => {
    expect(captureProfileDefaults("metadata")).toEqual({ captureBodies: false, captureConsole: false });
    expect(captureProfileDefaults("network-console")).toEqual({ captureBodies: false, captureConsole: true });
    expect(captureProfileDefaults("safe-bodies")).toEqual({ captureBodies: true, captureConsole: true });
    expect(inferCaptureProfile({ captureBodies: true, captureConsole: false })).toBe("safe-bodies");
    expect(inferCaptureProfile({ captureConsole: false })).toBe("metadata");
  });

  it("normalizes legacy session options without changing their behavior", async () => {
    const legacy = sampleSession({
      options: { captureBodies: true, captureConsole: true, redactionEnabled: true } as never,
    });
    await writeSessionData({ ...emptySessionData(), session: legacy });

    const data = await readSessionData();

    expect(data.session?.options.profile).toBe("safe-bodies");
    expect(data.session?.options.captureBodies).toBe(true);
    expect(data.session?.options.captureConsole).toBe(true);
  });
});
