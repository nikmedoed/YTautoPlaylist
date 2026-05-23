// Inline queue helper tests. Covers metadata resolution for progress and current queue entries.
import assert from "assert";
import { resolveProgressPercentFromMap } from "../src/progress.js";
import { resolveInlineQueueCurrentEntry } from "../src/content/inline-queue/renderer.js";

{
  const progress = new Map([
    ["hidden", { percent: 0 }],
    ["rounded", { percent: 49.6 }],
    ["clamped", { percent: 101 }],
  ]);
  assert.strictEqual(resolveProgressPercentFromMap(progress, "missing"), null);
  assert.strictEqual(resolveProgressPercentFromMap(progress, "hidden"), null);
  assert.strictEqual(resolveProgressPercentFromMap(progress, "rounded"), 50);
  assert.strictEqual(resolveProgressPercentFromMap(progress, "clamped"), 100);

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
