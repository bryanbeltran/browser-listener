import { describe, expect, it } from "vitest";
import { buildCoverageReport } from "../src/export/coverage.js";
import type { SessionData } from "../src/shared/types.js";
import { sampleSession } from "./helpers/fixtures.js";

function dataWithActivity(): SessionData {
  return {
    session: sampleSession({
      tabUrl: "https://www.facebook.com/groups/example",
      health: {
        ...sampleSession().health,
        truncation: { network: 2 },
        partialGaps: [{ at: 1, reason: "debugger_detach: canceled" }],
        persistenceErrors: ["quota"],
      },
    }),
    network: [
      {
        id: "network-1",
        sessionId: "test-session-1",
        requestId: "request-1",
        timestamp: 1,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
      },
    ],
    enrichments: {
      facebookGroups: {
        groups: [{ id: "g1", name: "Example" }],
        members: [],
        people: [],
        posts: [
          {
            id: "p1",
            text: "A captured post",
            authorId: "u1",
            source: "feed",
            partialParse: true,
          },
        ],
        comments: [{ id: "c1", authorName: "Name", postId: "p1", source: "feed" }],
        reactions: [
          {
            userId: "u2",
            userName: "Reacting User",
            postId: "p1",
            target: "post",
            targetText: "A captured post",
            source: "dialog",
          },
        ],
        graphqlQueryHints: [],
        parseWarnings: ["partial response"],
      },
    },
  };
}

describe("coverage report", () => {
  it("summarizes provenance, field coverage, and quality signals", () => {
    const report = buildCoverageReport(dataWithActivity());

    expect(report.schemaVersion).toBe(1);
    expect(report.source.tabUrl).toContain("facebook.com");
    expect(report.totals).toMatchObject({
      network: 1,
      groups: 1,
      posts: 1,
      comments: 1,
      reactions: 1,
    });
    expect(report.fields.posts.text).toMatchObject({ present: 1, total: 1, percent: 100 });
    expect(report.fields.comments.text).toMatchObject({ present: 0, total: 1, percent: 0 });
    expect(report.fields.reactions.targetText).toMatchObject({ present: 1, total: 1, percent: 100 });
    expect(report.quality).toEqual({
      partialPosts: 1,
      parseWarnings: 1,
      networkTruncated: 2,
      healthGaps: 1,
      persistenceErrors: 1,
    });
  });
});
