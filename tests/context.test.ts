import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureBrowserContext } from "../src/capture/context.js";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("richer browser context", () => {
  beforeEach(async () => {
    installChromeStorageMock();
    const sendCommand = vi.fn(async (_debuggee: unknown, method: string) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            value: {
              url: "https://example.test/problem",
              title: "Problem",
              visibilityState: "visible",
              focused: true,
              online: true,
              viewport: { width: 1280, height: 720 },
              deviceScaleFactor: 2,
              navigationTiming: {
                durationMs: 123,
                responseStartMs: 20,
                domContentLoadedMs: 80,
                loadEventMs: 120,
                transferSize: 4096,
              },
              resourceTiming: {
                count: 3,
                totalDurationMs: 44,
                slowestDurationMs: 30,
                totalTransferSize: 8192,
              },
              longTaskSummary: { count: 2, totalDurationMs: 70, longestDurationMs: 50 },
            },
          },
        };
      }
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "root", url: "https://example.test/problem", securityOrigin: "https://example.test" },
            childFrames: [
              { frame: { id: "child", parentId: "root", url: "https://cdn.example.test/frame" } },
            ],
          },
        };
      }
      return {};
    });
    vi.stubGlobal("chrome", {
      ...chrome,
      storage: (chrome as typeof chrome).storage,
      runtime: { getManifest: () => ({ version: "0.3.26", manifest_version: 3 }) },
      debugger: { sendCommand },
      tabs: { get: vi.fn(async () => ({ id: 1, url: "https://example.test/problem", title: "Problem" })) },
    });
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("captures bounded timing aggregates, frame metadata, and capabilities", async () => {
    const snapshot = await captureBrowserContext(1);

    expect(snapshot?.frameTree).toMatchObject({
      browserSupport: "cdp-page-v1",
      rootId: "root",
      frames: [
        expect.objectContaining({ id: "root", childCount: 1 }),
        expect.objectContaining({ id: "child", parentId: "root", childCount: 0 }),
      ],
    });
    expect(snapshot?.navigationTiming?.loadEventMs).toBe(120);
    expect(snapshot?.resourceTiming).toMatchObject({ count: 3, totalTransferSize: 8192 });
    expect(snapshot?.longTaskSummary).toMatchObject({ count: 2, longestDurationMs: 50 });
    expect(snapshot?.capabilities?.adapter).toBe("chromium-mv3");
    expect(snapshot?.capabilities?.debuggerDomains.Page.supported).toBe(true);

    const stored = await readSessionData();
    expect(stored.contextSnapshots?.[0]?.frameTree?.frames).toHaveLength(2);
  });

  it("records unsupported frame-tree capability without failing the capture", async () => {
    const sendCommand = vi.fn(async (_debuggee: unknown, method: string) => {
      if (method === "Runtime.evaluate") return { result: { value: { url: "https://example.test" } } };
      throw new Error("Page domain unavailable");
    });
    vi.stubGlobal("chrome", {
      ...chrome,
      storage: (chrome as typeof chrome).storage,
      runtime: { getManifest: () => ({ version: "0.3.26", manifest_version: 3 }) },
      debugger: { sendCommand },
      tabs: { get: vi.fn(async () => ({ id: 1, url: "https://example.test" })) },
    });

    const snapshot = await captureBrowserContext(1);
    expect(snapshot?.frameTree).toEqual({ browserSupport: "unsupported", frames: [] });
    expect(snapshot?.url).toBe("https://example.test");
  });
});
