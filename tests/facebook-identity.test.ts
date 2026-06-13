import { describe, expect, it } from "vitest";
import {
  backfillAuthorIds,
  dedupePeopleById,
  enrichReactionContext,
  syncLinkedCommentAuthors,
} from "../src/enrichers/facebook-identity.js";
import type { FacebookComment, FacebookPerson, FacebookPost, FacebookReaction } from "../src/shared/types.js";

describe("facebook identity", () => {
  it("dedupes people by user id", () => {
    const people: FacebookPerson[] = [
      { id: "1", name: "Amy", source: "a" },
      { id: "1", name: "Amy Louise", source: "b" },
      { id: "2", name: "Bob", source: "c" },
    ];
    const out = dedupePeopleById(people);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.id === "1")?.name).toBe("Amy Louise");
  });

  it("backfills authorId from unique display name", () => {
    const people: FacebookPerson[] = [{ id: "42", name: "Casey Jones", source: "x" }];
    const posts: FacebookPost[] = [
      { id: "p1", authorName: "Casey Jones", source: "feed" },
    ];
    const comments: FacebookComment[] = [
      { id: "c1", authorName: "casey jones", source: "dialog" },
    ];
    const { posts: outPosts, comments: outComments } = backfillAuthorIds(posts, comments, {
      people,
    });
    expect(outPosts[0]?.authorId).toBe("42");
    expect(outComments[0]?.authorId).toBe("42");
  });

  it("attaches denormalized reaction target context", () => {
    const posts: FacebookPost[] = [
      {
        id: "s1",
        postId: "100",
        authorId: "9",
        authorName: "Author",
        text: "Post body",
        source: "feed",
      },
    ];
    const comments: FacebookComment[] = [
      {
        id: "cm1",
        postId: "100",
        authorId: "8",
        authorName: "Commenter",
        text: "Reply text",
        source: "dialog",
      },
    ];
    const reactions: FacebookReaction[] = [
      {
        userId: "7",
        userName: "Reactor",
        postId: "100",
        target: "post",
        source: "CometUFIReactionsDialogTabContentRefetchQuery",
      },
      {
        userId: "6",
        userName: "Reactor2",
        postId: "100",
        commentId: "cm1",
        target: "comment",
        source: "CometUFIReactionsDialogTabContentRefetchQuery",
      },
    ];
    const enriched = enrichReactionContext(reactions, posts, comments);
    expect(enriched[0]?.targetAuthorId).toBe("9");
    expect(enriched[0]?.targetText).toBe("Post body");
    expect(enriched[1]?.targetAuthorId).toBe("8");
    expect(enriched[1]?.targetText).toBe("Reply text");
    expect(enriched[1]?.targetPostId).toBe("100");
  });

  it("syncs authorId onto nested linkedComments after backfill", () => {
    const comments: FacebookComment[] = [
      { id: "cm1", authorName: "Casey Jones", source: "dialog" },
    ];
    const people: FacebookPerson[] = [{ id: "42", name: "Casey Jones", source: "x" }];
    const { comments: filled } = backfillAuthorIds([], comments, { people });
    const posts: FacebookPost[] = [
      {
        id: "p1",
        postId: "100",
        source: "feed",
        linkedComments: [{ id: "cm1", authorName: "Casey Jones" }],
      },
    ];
    const synced = syncLinkedCommentAuthors(posts, filled);
    expect(synced[0]?.linkedComments?.[0]?.authorId).toBe("42");
  });

  it("backfills authorId from group member when name is unique", () => {
    const posts: FacebookPost[] = [{ id: "p1", authorName: "Member Only", source: "feed" }];
    const { posts: outPosts } = backfillAuthorIds(posts, [], {
      people: [],
      members: [{ userId: "99", name: "Member Only" }],
    });
    expect(outPosts[0]?.authorId).toBe("99");
  });

  it("accepts legacy people[] argument for backward compatibility", () => {
    const people: FacebookPerson[] = [{ id: "42", name: "Casey Jones", source: "x" }];
    const posts: FacebookPost[] = [{ id: "p1", authorName: "Casey Jones", source: "feed" }];
    const { posts: outPosts } = backfillAuthorIds(posts, [], people);
    expect(outPosts[0]?.authorId).toBe("42");
  });
});
