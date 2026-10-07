import test from "node:test";
import assert from "node:assert/strict";
import { OxigraphStore } from "@origintrail-official/dkg-storage";
import { createSwarmStats, sharedPostCountQuery } from "../swarm-stats.mjs";

test("shared stats retain stale counts and disclose missing usage stores without invented zeros", async () => {
  const store = new OxigraphStore();
  let at = Date.parse("2026-10-07T12:00:00Z");
  let reads = 0;
  let unavailable = false;
  const stats = createSwarmStats({ clock: () => at, activitySnapshot() { throw new Error("fixture missing store"); },
    async querySharedPosts() {
      reads++;
      if (unavailable) throw new Error("fixture unavailable");
      return { result: await store.query(sharedPostCountQuery) };
    } });
  try {
    await store.insert([{ subject: "https://x.com/i/status/123456789", predicate: "https://schema.org/articleBody", object: '"post"' }]);
    const results = await Promise.all([stats.snapshot(), stats.snapshot(), stats.snapshot()]);
    assert.equal(reads, 1);
    assert.equal(results[0].sharedPosts, 1);
    assert.equal(results[0].toolCalls, null);
    assert.equal(results[0].availability.usage, "unavailable");
    const verifiedAt = results[0].sharedPostsUpdatedAt;
    unavailable = true;
    at += 300001;
    const stale = await stats.snapshot();
    assert.equal(stale.sharedPosts, 1);
    assert.equal(stale.sharedPostsUpdatedAt, verifiedAt);
    assert.equal(stale.availability.sharedMemory, "stale");
    await stats.snapshot();
    assert.equal(reads, 2);
    const missing = createSwarmStats({ activitySnapshot() { throw new Error("fixture missing store"); },
      querySharedPosts() { throw new Error("fixture unavailable"); } });
    const empty = await missing.snapshot();
    assert.equal(empty.sharedPosts, null);
    assert.equal(empty.availability.sharedMemory, "unavailable");
  } finally { await store.close(); }
});
