import { describe, expect, it } from "vitest";
import { buildExportManifest } from "../src/export/manifest-builder.js";
import { buildPrivacyReceipt } from "../src/export/privacy-receipt.js";
import { buildCoverageReport } from "../src/export/coverage.js";
import {
  EXCLUDED_FIELD,
  sanitizeConsoleEntry,
  sanitizeNavigationEntry,
  sanitizeNetworkEntry,
  sanitizeScreenshotEntry,
} from "../src/shared/field-policy.js";
import {
  DEFAULT_CAPTURE_FIELDS,
  normalizeCaptureDuration,
  normalizeCaptureFields,
  normalizeFrameIds,
} from "../src/shared/types.js";
import { leakySessionData, sampleSession } from "./helpers/fixtures.js";

describe("field-level capture policy", () => {
  it("defaults to redacted-safe text fields with visual evidence opt-in", () => {
    expect(DEFAULT_CAPTURE_FIELDS.visualEvidence).toBe(false);
    expect(normalizeCaptureFields({ urls: false, visualEvidence: true })).toMatchObject({
      urls: false,
      headers: true,
      visualEvidence: true,
    });
    expect(normalizeFrameIds(["0", 0, " child ", ""])).toEqual(["0", "child"]);
    expect(normalizeCaptureDuration(2_000.9)).toBe(2_000);
    expect(normalizeCaptureDuration(0)).toBeUndefined();
  });

  it("removes excluded network, navigation, console, and visual values", () => {
    const fields = { ...DEFAULT_CAPTURE_FIELDS, urls: false, headers: false, requestBodies: false, responseBodies: false, consoleArguments: false, navigationTitles: false };
    const network = sanitizeNetworkEntry({
      id: "network",
      sessionId: "session",
      requestId: "request",
      timestamp: 1,
      url: "https://example.test/api?token=secret",
      method: "POST",
      type: "fetch",
      requestHeaders: { Authorization: "Bearer secret" },
      responseHeaders: { "content-type": "application/json" },
      requestBody: "secret request",
      responseBody: "secret response",
    }, fields);
    expect(network).toMatchObject({
      url: EXCLUDED_FIELD,
      requestBodyState: "excluded",
      responseBodyState: "excluded",
      requestBodySkipReason: "field-disabled",
      responseBodySkipReason: "field-disabled",
    });
    expect(network.requestHeaders).toBeUndefined();
    expect(network.responseHeaders).toBeUndefined();
    expect(network.requestBody).toBeUndefined();
    expect(network.responseBody).toBeUndefined();
    expect(sanitizeNavigationEntry({ id: "nav", sessionId: "session", timestamp: 1, url: "https://secret.test", title: "Secret" }, fields)).toMatchObject({ url: EXCLUDED_FIELD });
    expect(sanitizeNavigationEntry({ id: "nav", sessionId: "session", timestamp: 1, url: "https://secret.test", title: "Secret" }, fields).title).toBeUndefined();
    expect(sanitizeConsoleEntry({ id: "console", sessionId: "session", timestamp: 1, level: "log", text: "[EXCLUDED]", args: ["secret"], url: "https://secret.test" }, fields)).toMatchObject({ text: "[EXCLUDED]" });
    expect(sanitizeConsoleEntry({ id: "console", sessionId: "session", timestamp: 1, level: "log", text: "[EXCLUDED]", args: ["secret"], url: "https://secret.test" }, fields).args).toBeUndefined();
    expect(sanitizeScreenshotEntry({ id: "shot", sessionId: "session", timestamp: 1, tabId: 1, format: "png", state: "observed", data: "secret", byteLength: 6 }, fields)).toMatchObject({ state: "excluded", reason: "field-disabled" });
  });

  it("does not export known secrets when every sensitive field is denied", async () => {
    const data = leakySessionData();
    data.session!.options.fields = {
      ...DEFAULT_CAPTURE_FIELDS,
      urls: false,
      headers: false,
      requestBodies: false,
      responseBodies: false,
      consoleArguments: false,
      navigationTitles: false,
    };
    const manifest = buildExportManifest(data);
    expect(manifest.privacy.fields.urls.excluded).toBeGreaterThan(0);
    expect(manifest.privacy.fields.headers.excluded).toBe(1);
    expect(manifest.privacy.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Field-level consent excluded")]));
    expect(manifest.privacy.exportDestination).toBe("local-device");
  });

  it("keeps earlier epoch field meaning when building a receipt", () => {
    const data = leakySessionData();
    const first = sampleSession().options.fields!;
    const second = { ...DEFAULT_CAPTURE_FIELDS, urls: false };
    data.session!.policyEpochs = [
      {
        id: "epoch-one",
        startedAt: 1,
        endedAt: 2,
        profile: "network-console",
        redactionEnabled: true,
        captureBodies: false,
        captureConsole: true,
        allowedOrigins: [],
        budgets: { perOriginBytes: 1, perCategoryBytes: 1 },
        filters: { urlIncludes: [], urlExcludes: [], mimeTypes: [] },
        fields: first,
        frameIds: [],
        targetTabIds: [1],
      },
      {
        id: "epoch-two",
        startedAt: 2,
        profile: "network-console",
        redactionEnabled: true,
        captureBodies: false,
        captureConsole: true,
        allowedOrigins: [],
        budgets: { perOriginBytes: 1, perCategoryBytes: 1 },
        filters: { urlIncludes: [], urlExcludes: [], mimeTypes: [] },
        fields: second,
        frameIds: [],
        targetTabIds: [1],
      },
    ];
    data.network[0]!.policyEpochId = "epoch-one";
    data.navigation[0]!.policyEpochId = "epoch-two";
    const receipt = buildPrivacyReceipt(data, buildCoverageReport(data));
    expect(receipt.fields.urls.captured).toBeGreaterThan(0);
    expect(receipt.fields.urls.excluded).toBeGreaterThan(0);
  });
});
