import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const allowedTools = new Set(["graph_info", "query_graph", "search_graph", "get_posting_context", "get_swarm_policy", "write_working_memory", "enable_writer_access", "share_to_swm", "list_contexts", "join_context", "list_collective_pushes", "get_network_stats"]);

export function trackToolOutcome(authStore, handler) {
  return async (...args) => {
    const context = authStore.getStore();
    if (context) context.toolOk = false;
    const result = await handler(...args);
    if (context) context.toolOk = result?.isError !== true;
    return result;
  };
}

export function createActivity(path = process.env.DKG_MCP_ACTIVITY_STORE || "/root/dkg-public-mcp/data/activity.sqlite") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, graph TEXT NOT NULL,
      installation TEXT NOT NULL, tool TEXT NOT NULL, ok INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
    CREATE INDEX IF NOT EXISTS activity_installation_at ON activity(installation,at);`);
  if (!db.prepare("PRAGMA table_info(activity)").all().some(column => column.name === "outcome_known")) {
    db.exec("ALTER TABLE activity ADD COLUMN outcome_known INTEGER NOT NULL DEFAULT 0");
  }
  const insert = db.prepare("INSERT INTO activity(at,graph,installation,tool,ok,outcome_known) VALUES(?,?,?,?,?,1)");
  const aggregate = `COUNT(DISTINCT installation) AS connectedInstallations, COUNT(*) AS toolCalls,
    SUM(CASE WHEN tool IN ('query_graph','search_graph','get_posting_context') THEN 1 ELSE 0 END) AS queries,
    SUM(CASE WHEN tool = 'write_working_memory' THEN 1 ELSE 0 END) AS contributionAttempts,
    SUM(CASE WHEN outcome_known = 1 AND ok = 1 THEN 1 ELSE 0 END) AS successfulToolCalls,
    SUM(CASE WHEN outcome_known = 1 AND ok = 0 THEN 1 ELSE 0 END) AS failedToolCalls,
    SUM(CASE WHEN outcome_known = 0 THEN 1 ELSE 0 END) AS unknownOutcomeCalls,
    SUM(CASE WHEN outcome_known = 1 AND ok = 1 AND tool = 'write_working_memory' THEN 1 ELSE 0 END) AS successfulDraftSubmissions`;
  const totals = db.prepare(`SELECT ${aggregate} FROM activity`);
  const recent = db.prepare(`SELECT ${aggregate} FROM activity WHERE at >= ? AND at <= ?`);
  const normalize = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? 0]));
  let cached;
  let cachedUntil = 0;
  return {
    record({ family, tool, graph, ok, at = Date.now() }) {
      if (!family || !allowedTools.has(tool)) return;
      insert.run(at, graph, createHash("sha256").update(family).digest("hex"), tool, ok ? 1 : 0);
      cachedUntil = 0;
    },
    snapshot(at = Date.now()) {
      if (cached && at < cachedUntil) return cached;
      cached = { period: "since tracking began", updatedAt: new Date(at).toISOString(),
        ...normalize(totals.get()),
        windows: {
          last24Hours: normalize(recent.get(at - 24 * 3600000, at)),
          last7Days: normalize(recent.get(at - 7 * 24 * 3600000, at)),
        } };
      cachedUntil = at + 60000;
      return cached;
    },
    close() { db.close(); },
  };
}
