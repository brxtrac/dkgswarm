import { DatabaseSync } from "node:sqlite";
import { readActivitySnapshot } from "./activity.mjs";

function collectedSources() {
  const db = new DatabaseSync(process.env.WATCH_DB || "/root/dkg-swarm-webhooks/data/watcher.sqlite", { readOnly: true });
  try { return db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE stage = 'raw-dkg' AND status = 'completed'").get().count; }
  finally { db.close(); }
}

// Both services keep their existing fields and report absent stores as unknown.
// The collector only reads the activity DB; it never initializes or migrates it.
export function createSwarmStats({ querySharedPosts, activitySnapshot = readActivitySnapshot, clock = Date.now }) {
  let shared = { count: null, updatedAt: null, expiresAt: 0 };
  let refresh;
  let retryAt = 0;
  async function sharedPosts() {
    if (clock() < shared.expiresAt || clock() < retryAt) return;
    if (!refresh) refresh = (async () => {
      try {
        const result = await querySharedPosts();
        const value = result?.result?.bindings?.[0]?.count;
        const count = Number(String(value).match(/^"(\d+)"(?:\^\^<[^>]+>)?$/)?.[1]);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Shared count unavailable");
        shared = { count, updatedAt: new Date(clock()).toISOString(), expiresAt: clock() + 300000 };
      } catch { retryAt = clock() + 10000; }
    })().finally(() => { refresh = undefined; });
    await refresh;
  }
  return {
    async snapshot() {
      let activity;
      let sources = null;
      try { activity = activitySnapshot(); } catch {}
      try { sources = collectedSources(); } catch {}
      await sharedPosts();
      return {
        ...(activity || { period: "since tracking began", updatedAt: new Date(clock()).toISOString(),
          connectedInstallations: null, toolCalls: null, queries: null, contributionAttempts: null,
          successfulToolCalls: null, failedToolCalls: null, unknownOutcomeCalls: null, successfulDraftSubmissions: null, windows: null }),
        collectedSources: sources,
        sharedPosts: shared.count,
        sharedPostsUpdatedAt: shared.updatedAt,
        availability: { usage: activity ? "available" : "unavailable", collection: sources === null ? "unavailable" : "available",
          sharedMemory: shared.count === null ? "unavailable" : clock() >= shared.expiresAt ? "stale" : "available" },
      };
    },
  };
}

export const sharedPostCountQuery = "SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { ?s <https://schema.org/articleBody> ?body }";
