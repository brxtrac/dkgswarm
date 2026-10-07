import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const allowedTools = new Set(["graph_info", "query_graph", "search_graph", "get_swarm_policy", "write_working_memory", "enable_writer_access", "share_to_swm", "list_contexts", "join_context"]);

const defaultPath = () => process.env.DKG_MCP_ACTIVITY_STORE || "/root/dkg-public-mcp/data/activity.sqlite";

export function createActivity(filename = defaultPath(), { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { readOnly });
  db.exec("PRAGMA busy_timeout=5000;");
  if (!readOnly) db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, graph TEXT NOT NULL,
      installation TEXT NOT NULL, tool TEXT NOT NULL, ok INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
    CREATE INDEX IF NOT EXISTS activity_installation_at ON activity(installation,at);`);
  const columns = db.prepare("PRAGMA table_info(activity)").all();
  if (readOnly && !columns.length) {
    db.close();
    throw new Error("Activity table unavailable");
  }
  let outcomeKnown = columns.some(column => column.name === "outcome_known");
  if (!readOnly && !outcomeKnown) {
    // Historical ok values describe HTTP status, not semantic tool outcomes.
    db.exec("ALTER TABLE activity ADD COLUMN outcome_known INTEGER NOT NULL DEFAULT 0");
    outcomeKnown = true;
  }
  const known = outcomeKnown ? "outcome_known" : "0";
  const insert = readOnly ? null : db.prepare("INSERT INTO activity(at,graph,installation,tool,ok,outcome_known) VALUES(?,?,?,?,?,1)");
  const aggregate = `COUNT(DISTINCT installation) AS connectedInstallations, COUNT(*) AS toolCalls,
    SUM(CASE WHEN tool IN ('query_graph','search_graph') THEN 1 ELSE 0 END) AS queries,
    SUM(CASE WHEN tool = 'write_working_memory' THEN 1 ELSE 0 END) AS contributionAttempts,
    SUM(CASE WHEN ${known} = 1 AND ok = 1 THEN 1 ELSE 0 END) AS successfulToolCalls,
    SUM(CASE WHEN ${known} = 1 AND ok = 0 THEN 1 ELSE 0 END) AS failedToolCalls,
    SUM(CASE WHEN ${known} = 0 THEN 1 ELSE 0 END) AS unknownOutcomeCalls,
    SUM(CASE WHEN ${known} = 1 AND ok = 1 AND tool = 'write_working_memory' THEN 1 ELSE 0 END) AS successfulDraftSubmissions`;
  const totals = db.prepare(`SELECT ${aggregate} FROM activity`);
  const recent = db.prepare(`SELECT ${aggregate} FROM activity WHERE at >= ? AND at <= ?`);
  const normalize = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value || 0]));
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

export function readActivitySnapshot(filename = defaultPath(), at = Date.now()) {
  const activity = createActivity(filename, { readOnly: true });
  try { return activity.snapshot(at); }
  finally { activity.close(); }
}
