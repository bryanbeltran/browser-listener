import { describe, expect, it } from "vitest";
import {
  API_BODY_LIMITS,
  apiBodyCapForRequest,
  decodeCdpBody,
  prepareBodyForStorage,
  shouldCaptureApiBody,
} from "../src/capture/api-body-capture.js";
import { REDACTED } from "../src/redaction/engine.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../src/shared/types.js";

describe("api body capture", () => {
  it("enables GraphQL bodies by default", () => {
    expect(DEFAULT_CAPTURE_OPTIONS.graphqlBodies).toBe(true);
  });

  it("uses larger cap for feed pagination GraphQL", () => {
    const postData =
      "fb_api_req_friendly_name=CometNewsFeedPaginationQuery&doc_id=123";
    expect(apiBodyCapForRequest(postData)).toBe(API_BODY_LIMITS.perResponseLarge);
    expect(apiBodyCapForRequest("doc_id=1")).toBe(API_BODY_LIMITS.perResponse);
  });

  it("uses larger cap for single post dialog GraphQL", () => {
    const postData =
      "fb_api_req_friendly_name=CometSinglePostDialogContentQuery&doc_id=123";
    expect(apiBodyCapForRequest(postData)).toBe(API_BODY_LIMITS.perResponseLarge);
  });

  it("uses larger cap for group feed pagination GraphQL", () => {
    const postData =
      "fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery&doc_id=123";
    expect(apiBodyCapForRequest(postData)).toBe(API_BODY_LIMITS.perResponseLarge);
  });

  it("matches Facebook GraphQL and bulk-route URLs only", () => {
    expect(shouldCaptureApiBody("https://www.facebook.com/api/graphql/")).toBe(true);
    expect(shouldCaptureApiBody("https://www.facebook.com/ajax/bulk-route-definitions/")).toBe(
      true,
    );
    expect(shouldCaptureApiBody("https://www.facebook.com/photos")).toBe(false);
    expect(shouldCaptureApiBody("https://example.com/api/graphql/")).toBe(false);
  });

  it("redacts JSON bodies and truncates per-response cap", () => {
    const raw = JSON.stringify({ message: "ok", access_token: "secret-token-value" });
    const prep = prepareBodyForStorage(raw, API_BODY_LIMITS.perResponse);
    expect(prep.text).toContain(REDACTED);
    expect(prep.text).not.toContain("secret-token-value");
    expect(prep.truncated).toBe(false);

    const huge = JSON.stringify({ blob: "x".repeat(API_BODY_LIMITS.perResponse + 1000) });
    const truncated = prepareBodyForStorage(huge, API_BODY_LIMITS.perResponse);
    expect(truncated.truncated).toBe(true);
    expect(truncated.byteLength).toBe(API_BODY_LIMITS.perResponse);
  });

  it("decodes base64 CDP bodies", () => {
    const text = decodeCdpBody(btoa('{"ok":true}'), true);
    expect(text).toBe('{"ok":true}');
    expect(decodeCdpBody("plain", false)).toBe("plain");
  });
});
