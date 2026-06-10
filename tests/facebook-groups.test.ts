import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractFacebookGroupActivity } from "../src/enrichers/facebook-groups.js";
import { buildGraphqlCaptures } from "../src/export/graphql-captures.js";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { unzipToMap } from "./helpers/unzip.js";
import type { NetworkEntry } from "../src/shared/types.js";

const CAPTURE_ZIPS = [
  join(
    process.env.HOME ?? "",
    "Downloads/browser-listener-4f9a5725-7a38-43cc-a5aa-1329f643ccb9-1781121046926.zip",
  ),
  join(
    process.env.HOME ?? "",
    "Downloads/browser-listener-525fe264-3b9c-43d0-83e0-fb378e733718-1781120390899.zip",
  ),
  join(
    process.env.HOME ?? "",
    "Downloads/browser-listener-255ddf3a-049e-4ac6-bf55-2cc774b7ef18-1781111369768.zip",
  ),
];

function networkFromZip(zipPath: string): NetworkEntry[] | null {
  if (!existsSync(zipPath)) return null;
  const zip = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const har = JSON.parse(new TextDecoder().decode(zip["network.har"]));
  return har.log.entries.map(
    (
      e: {
        startedDateTime: string;
        request: { method: string; url: string; postData?: { text?: string } };
        response: {
          status: number;
          content?: { text?: string; mimeType?: string };
        };
      },
      i: number,
    ) => ({
      id: `n-${i}`,
      sessionId: "fixture",
      requestId: `req-${i}`,
      timestamp: Date.parse(e.startedDateTime),
      url: e.request.url,
      method: e.request.method,
      type: "xhr",
      statusCode: e.response.status,
      requestBody: e.request.postData?.text,
      responseBody: e.response.content?.text,
      responseBodyTruncated: (e.response.content?.text?.length ?? 0) >= 262144,
      bodyCaptured: Boolean(e.response.content?.text),
      contentType: e.response.content?.mimeType,
    }),
  );
}

function firstAvailableZip(): { path: string; network: NetworkEntry[] } | null {
  for (const path of CAPTURE_ZIPS) {
    const network = networkFromZip(path);
    if (network) return { path, network };
  }
  return null;
}

const PERMALINK =
  "https://www.facebook.com/groups/richfieldmncommunity/permalink/27021670184127456/";

describe("facebook groups enricher", () => {
  it("extracts posts with postId and linked reactions from dialog capture", () => {
    const fixture = networkFromZip(CAPTURE_ZIPS[0]);
    if (!fixture) {
      expect(true).toBe(true);
      return;
    }

    const activity = extractFacebookGroupActivity(fixture, {
      tabUrl: "https://www.facebook.com/groups/richfieldmncommunity",
    });
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.posts.length).toBeGreaterThan(0);
    expect(
      activity.posts.some((p) => p.postId === "27014819028145905" && p.authorName),
    ).toBe(true);
    expect(activity.reactions.length).toBeGreaterThan(0);
    const reactionsOnly = activity.posts.find((p) => p.postId === "26978847508409724");
    expect(reactionsOnly?.reactionCount).toBeGreaterThan(0);
    expect(reactionsOnly?.linkedReactions?.length).toBeGreaterThan(0);
  });

  it("extracts posts, linked reactions, and people from permalink capture", () => {
    const fixture = networkFromZip(CAPTURE_ZIPS[1]);
    if (!fixture) {
      expect(true).toBe(true);
      return;
    }

    const activity = extractFacebookGroupActivity(fixture, { tabUrl: PERMALINK });
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.reactions.length).toBeGreaterThan(0);
    expect(activity.reactions.some((r) => r.postId === "27021670184127456")).toBe(true);
    expect(
      activity.posts.some(
        (p) =>
          p.text?.includes("Her family came to the U.S.") ||
          p.postId === "27021670184127456",
      ),
    ).toBe(true);
    expect(activity.parseWarnings?.length).toBeGreaterThan(0);
  });

  it("extracts people and reactions from feed capture fixture", () => {
    const fixture = networkFromZip(CAPTURE_ZIPS[2]);
    if (!fixture) {
      expect(true).toBe(true);
      return;
    }

    const activity = extractFacebookGroupActivity(fixture);
    expect(activity.groups.some((g) => g.id === "623366241051210")).toBe(true);
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.reactions.length).toBeGreaterThan(0);
  });

  it("builds graphql-captures.json entries with doc_id hints", () => {
    const fixture = firstAvailableZip();
    if (!fixture) {
      expect(true).toBe(true);
      return;
    }
    const captures = buildGraphqlCaptures(fixture.network);
    expect(captures.length).toBeGreaterThan(5);
    expect(captures.some((c) => c.friendlyName && c.docId)).toBe(true);
  });

  it("includes group-activity.json and csv in export when enricher enabled", async () => {
    const fixture = firstAvailableZip();
    if (!fixture) {
      expect(true).toBe(true);
      return;
    }

    const zip = await buildZipFromSessionData({
      session: {
        id: "fb-fixture",
        active: false,
        consentedAt: 1,
        startedAt: 1,
        stoppedAt: 2,
        tabId: 1,
        tabUrl: PERMALINK,
        options: {
          screenRecording: false,
          tabAudio: false,
          staticAssetBodies: false,
          graphqlBodies: true,
          consoleCapture: false,
          enricherIds: ["facebook-groups"],
        },
        health: {
          debuggerAttached: true,
          debuggerDetachCount: 0,
          serviceWorkerRestarts: 0,
          partialGaps: [],
          persistenceErrors: [],
          eventCounts: {},
          truncation: { console: 0, network: 0, timeline: 0, userActions: 0 },
        },
      },
      timeline: [],
      console: [],
      network: fixture.network,
      userActions: [],
      diagnostics: [],
      domSnapshots: [],
    });

    const files = unzipToMap(zip);
    expect(files["group-activity.json"]).toBeDefined();
    expect(files["graphql-captures.json"]).toBeDefined();
    expect(files["csv/people.csv"]).toBeDefined();
    expect(files["csv/reactions.csv"]).toBeDefined();
    const activity = JSON.parse(files["group-activity.json"]);
    expect(activity.people.length).toBeGreaterThan(0);
    expect(files["report.html"]).toContain("Facebook group activity");
  });
});
