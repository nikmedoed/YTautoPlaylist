// Video card tests. Covers card detection exclusions, inline queue skipping, and progress sync behavior.
import assert from "assert";
import { getProgressPercent } from "../src/progress.js";
import { inlinePlaylistState } from "../src/content/core/base.js";
import { updateInlinePlaylistState } from "../src/content/inline-queue/state.js";
import { shouldEnhanceVideoCardCandidate } from "../src/content/video-cards/decorations.js";

{
  assert.strictEqual(
    shouldEnhanceVideoCardCandidate({
      insideInlineQueue: true,
      hasNestedCandidate: false,
    }),
    false
  );
  assert.strictEqual(
    shouldEnhanceVideoCardCandidate({
      insideInlineQueue: false,
      hasNestedCandidate: true,
    }),
    false
  );
  assert.strictEqual(
    shouldEnhanceVideoCardCandidate({
      insideInlineQueue: false,
      hasNestedCandidate: false,
    }),
    true
  );
  console.log("video cards skip inline queue and nested card candidates");
}

{
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll() {
      return [];
    },
  };
  let syncCount = 0;
  try {
    updateInlinePlaylistState(
      {
        currentQueue: {
          id: "default",
          queue: [{ id: "progressVid1" }],
          currentIndex: 0,
        },
        videoProgress: {
          progressVid1: { percent: 42.4, updatedAt: 10 },
        },
      },
      {
        syncVideoCardProgress() {
          syncCount += 1;
        },
      }
    );
    assert.strictEqual(syncCount, 1);
    assert.strictEqual(getProgressPercent(inlinePlaylistState.progress, "progressVid1"), 42);
    assert.deepStrictEqual(
      inlinePlaylistState.progress.progressVid1,
      { percent: 42.4, updatedAt: 10 }
    );
  } finally {
    globalThis.document = previousDocument;
  }
  console.log("video card progress sync runs after playlist state changes");
}
