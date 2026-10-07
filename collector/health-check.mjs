#!/usr/bin/env node
// Daily flow check for the public swarm. Writes a status file the site reads.
// Fixes only dead services and collector rows stuck past max attempts.
// Never restarts Oxigraph, never discards, never shares to SWM.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function paths() {
  return {
    dkgApi: (process.env.DKG_API_URL || "http://127.0.0.1:9200").replace(/\/$/, ""),
    graphId: process.env.DKG_PUBLIC_GRAPH_ID || "trac-marketing",
    tokenFile: process.env.DKG_API_TOKEN_FILE || "/root/.dkg/auth.token",
    dbPath: process.env.WATCH_DB || "/root/dkg-swarm-webhooks/data/watcher.sqlite",
    statusPath: process.env.SWARM_HEALTH_STATUS || "/root/dkg-swarm-webhooks/data/health-status.json",
    logPath: process.env.SWARM_HEALTH_LOG || "/var/log/dkg-swarm-health.log",
    maxAttempts: Number(process.env.MAX_DKG_ATTEMPTS || 12),
  };
}
const STALE_MS = 26 * 60 * 60 * 1000;
const SERVICES = ["dkg.service", "dkg-public-mcp.service", "dkg-swarm-webhooks.service"];

const LEVELS = { green: 0, yellow: 1, red: 2 };

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  fs.appendFileSync(paths().logPath, text);
  console.log(line);
}

function token() {
  const line = fs.readFileSync(paths().tokenFile, "utf8").split(/\n/)
    .find((row) => row.trim() && !row.trim().startsWith("#"));
  return line?.trim() || "";
}

function systemctl(args) {
  try {
    return execFileSync("systemctl", args, { encoding: "utf8", timeout: 20000 }).trim();
  } catch (error) {
    return String(error.stdout || error.stderr || error.message || "").trim();
  }
}

function serviceActive(name) {
  return systemctl(["is-active", name]) === "active";
}

async function graphAsk() {
  const bearer = token();
  if (!bearer) return { ok: false, detail: "DKG token missing" };
  const { dkgApi, graphId } = paths();
  const response = await fetch(`${dkgApi}/api/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contextGraphId: graphId,
      view: "working-memory",
      sparql: "ASK { ?s ?p ?o }",
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return { ok: false, detail: `graph query HTTP ${response.status}` };
  const body = await response.json();
  const value = body?.result?.boolean ?? body?.result?.value;
  if (value !== true && value !== "true") return { ok: false, detail: "working memory ASK empty" };
  return { ok: true, detail: "working memory readable" };
}

function collectorSnapshot(db, maxAttempts) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM deliveries
    WHERE stage IN ('raw-dkg', 'derived-dkg') GROUP BY status`).all();
  const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  const stuck = db.prepare(`SELECT COUNT(*) AS count FROM deliveries
    WHERE stage IN ('raw-dkg', 'derived-dkg') AND status = 'pending' AND attempts >= ?`).get(maxAttempts).count;
  const oldestDue = db.prepare(`SELECT MIN(next_attempt_at) AS due FROM deliveries
    WHERE stage IN ('raw-dkg', 'derived-dkg') AND status = 'pending'`).get().due;
  const notExact = db.prepare(`SELECT COUNT(*) AS count FROM deliveries
    WHERE status = 'quarantined' AND last_error LIKE '%WM/SWM content not exactly verified%'`).get().count;
  return {
    completed: counts.completed || 0,
    pending: counts.pending || 0,
    quarantined: counts.quarantined || 0,
    stuck,
    oldestDue,
    notExact,
  };
}

function requeueStuck(db, maxAttempts) {
  const result = db.prepare(`UPDATE deliveries
    SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = 'health check requeued stuck delivery'
    WHERE stage IN ('raw-dkg', 'derived-dkg') AND status = 'pending' AND attempts >= ?`).run(new Date().toISOString(), maxAttempts);
  return result.changes;
}

function worse(level, next) {
  return LEVELS[next] > LEVELS[level] ? next : level;
}

function summaryFor(level, notes) {
  if (level === "red") return notes.find((note) => note.startsWith("down:")) || "Context graph flow is down.";
  if (level === "yellow") return notes[0] || "Context graph is catching up.";
  return "Context graph flow is healthy.";
}

export async function runHealthCheck({ restart = true, write = true } = {}) {
  const notes = [];
  const fixes = [];
  let level = "green";
  const services = {};

  for (const name of SERVICES) {
    let active = serviceActive(name);
    services[name] = active ? "active" : "down";
    if (!active && restart) {
      systemctl(["restart", name]);
      active = serviceActive(name);
      services[name] = active ? "restarted" : "down";
      fixes.push(active ? `restarted ${name}` : `restart failed ${name}`);
    }
    if (!active) {
      level = "red";
      notes.push(`down: ${name} is not running`);
    } else if (services[name] === "restarted") {
      level = worse(level, "yellow");
      notes.push(`restarted ${name}`);
    }
  }

  let graph = { ok: false, detail: "not checked" };
  try {
    graph = await graphAsk();
  } catch (error) {
    graph = { ok: false, detail: String(error.message || error).slice(0, 180) };
  }
  if (!graph.ok) {
    level = "red";
    notes.push(`down: ${graph.detail}`);
  }

  let collector = { pending: 0, stuck: 0, notExact: 0, completed: 0, quarantined: 0 };
  try {
    const db = new DatabaseSync(paths().dbPath);
    db.exec("PRAGMA busy_timeout = 5000");
    collector = collectorSnapshot(db, paths().maxAttempts);
    if (collector.stuck > 0 && restart) {
      const changed = requeueStuck(db, paths().maxAttempts);
      if (changed > 0) {
        fixes.push(`requeued ${changed} stuck deliveries`);
        collector.stuck = 0;
      }
    }
    db.close();
  } catch (error) {
    level = "red";
    notes.push(`down: collector db ${String(error.message || error).slice(0, 120)}`);
  }

  if (collector.stuck > 0) {
    level = "red";
    notes.push(`down: ${collector.stuck} deliveries stuck at max attempts`);
  }
  const dueMs = collector.oldestDue ? Date.parse(collector.oldestDue) : NaN;
  if (collector.pending > 80 || (Number.isFinite(dueMs) && Date.now() - dueMs > STALE_MS)) {
    level = worse(level, "yellow");
    notes.push(`collector backlog pending ${collector.pending}`);
  }
  if (collector.notExact > 0) {
    level = worse(level, "yellow");
    notes.push(`${collector.notExact} exact-content rows still reconciling`);
  }

  const curator = systemctl(["is-active", "trac-marketing-curator.timer"]);
  const curatorOk = curator === "active";
  if (!curatorOk) {
    level = worse(level, "yellow");
    notes.push("curator timer is not active");
  }

  const status = {
    level,
    ok: level !== "red",
    summary: summaryFor(level, notes),
    checkedAt: new Date().toISOString(),
    graph: paths().graphId,
    services,
    curatorTimer: curatorOk ? "active" : curator || "inactive",
    collector: {
      completed: collector.completed,
      pending: collector.pending,
      quarantined: collector.quarantined,
      notExact: collector.notExact,
    },
    fixes,
    notes: notes.slice(0, 8),
  };

  if (write) {
    const statusPath = paths().statusPath;
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    const tmp = `${statusPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`);
    fs.renameSync(tmp, statusPath);
    log(`${level} ${status.summary}${fixes.length ? ` fixes=${fixes.join("; ")}` : ""}`);
  }
  return status;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHealthCheck().then((status) => {
    process.exitCode = status.level === "red" ? 1 : 0;
  }).catch((error) => {
    log(`red health check crashed: ${String(error.message || error)}`);
    process.exitCode = 1;
  });
}
