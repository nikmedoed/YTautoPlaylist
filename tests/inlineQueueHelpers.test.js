// Inline queue helper tests. Covers metadata resolution for progress and current queue entries.
import assert from "assert";
import { getProgressPercent } from "../src/progress.js";
import { resolveInlineQueueCurrentEntry } from "../src/content/inline-queue/renderer.js";
import { requireInlineQueueResponse } from "../src/content/inline-queue/itemActions.js";
import {
  filterPendingInlineQueueRemovals,
  finishInlineQueueRemovals,
  isInlineQueueRenderLocked,
  markInlineQueueRemovalPending,
  releaseInlineQueueRenderLock,
} from "../src/content/inline-queue/pendingRemovals.js";

{
  const progress = {
    hidden: { percent: 0 },
    rounded: { percent: 49.6 },
    clamped: { percent: 101 },
  };
  assert.strictEqual(getProgressPercent(progress, "missing"), null);
  assert.strictEqual(getProgressPercent(progress, "hidden"), null);
  assert.strictEqual(getProgressPercent(progress, "rounded"), 50);
  assert.strictEqual(getProgressPercent(progress, "clamped"), 100);
  assert.strictEqual(getProgressPercent({ stored: { percent: 33.2 } }, "stored"), 33);

  const entries = [{ id: "first" }, { id: "second" }];
  assert.strictEqual(
    resolveInlineQueueCurrentEntry({
      entries,
      currentIndex: 1,
      currentVideoId: "first",
    }),
    entries[1]
  );
  assert.strictEqual(
    resolveInlineQueueCurrentEntry({
      entries,
      currentIndex: 5,
      currentVideoId: "first",
    }),
    entries[0]
  );
  assert.strictEqual(
    resolveInlineQueueCurrentEntry({
      entries,
      currentIndex: null,
      currentVideoId: "unknown",
    }),
    null
  );
  console.log(
    "inline queue render metadata helpers resolve progress and current entries"
  );
}

{
  const entries = [{ id: "first" }, { id: "second" }, { id: "third" }];
  markInlineQueueRemovalPending("list-a", "second");
  assert.strictEqual(isInlineQueueRenderLocked("list-a"), true);
  assert.deepStrictEqual(
    filterPendingInlineQueueRemovals(entries, "list-a").map((entry) => entry.id),
    ["first", "third"]
  );
  assert.deepStrictEqual(
    filterPendingInlineQueueRemovals(entries, "list-b").map((entry) => entry.id),
    ["first", "second", "third"]
  );
  finishInlineQueueRemovals("list-a", ["second"]);
  assert.strictEqual(filterPendingInlineQueueRemovals(entries, "list-a"), entries);
  assert.strictEqual(isInlineQueueRenderLocked("list-a"), true);
  releaseInlineQueueRenderLock("list-a");
  assert.strictEqual(isInlineQueueRenderLocked("list-a"), false);
  console.log("inline queue pending removals suppress stale state per list");
}

{
  const response = { currentQueue: { queue: [] } };
  assert.strictEqual(requireInlineQueueResponse(response), response);
  assert.throws(
    () => requireInlineQueueResponse(null),
    /QUEUE_ACTION_NO_RESPONSE/
  );
  assert.throws(
    () => requireInlineQueueResponse({ error: "mutation failed" }),
    /mutation failed/
  );
  console.log("inline queue actions reject missing and error responses");
}
