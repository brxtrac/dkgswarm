import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const allowedTools = new Set(["graph_info", "query_graph", "search_graph", "get_swarm_policy", "write_working_memory", "enable_writer_access", "share_to_swm", "list_contexts", "join_context"]);

export function createActivity(path = process.env.DKG_MCP_ACTIVITY_STORE || "/root/dkg-public-mcp/data/activity.sqlite") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, graph TEXT NOT NULL,
      installation TEXT NOT NULL, tool TEXT NOT NULL, ok INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
    CREATE INDEX IF NOT EXISTS activity_installation_at ON activity(installation,at);`);
  const insert = db.prepare("INSERT INTO activity(at,graph,installation,tool,ok) VALUES(?,?,?,?,?)");
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
      const totals = db.prepare(`SELECT COUNT(DISTINCT installation) AS connectedInstallations, COUNT(*) AS toolCalls,
        SUM(CASE WHEN tool IN ('query_graph','search_graph') THEN 1 ELSE 0 END) AS queries,
        SUM(CASE WHEN tool = 'write_working_memory' THEN 1 ELSE 0 END) AS contributionAttempts
        FROM activity`).get();
      cached = { period: "since tracking began", updatedAt: new Date(at).toISOString(),
        connectedInstallations: totals.connectedInstallations || 0, toolCalls: totals.toolCalls || 0,
        queries: totals.queries || 0, contributionAttempts: totals.contributionAttempts || 0 };
      cachedUntil = at + 60000;
      return cached;
    },
    close() { db.close(); },
  };
}
