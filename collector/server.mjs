#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import express from "express";
import { createWatcher, normalizeXHandle } from "./watcher.mjs";

const DKG_API = (process.env.DKG_API_URL || "http://127.0.0.1:9200").replace(/\/$/, "");
const GRAPH_ID = process.env.DKG_PUBLIC_GRAPH_ID || "trac-marketing";
let sharedStats = { count: null, expiresAt: 0 };
let sharedStatsRefresh;

async function sharedPostCount() {
  if (Date.now() < sharedStats.expiresAt) return sharedStats.count;
  if (!sharedStatsRefresh) sharedStatsRefresh = (async () => {
    const token = fs.readFileSync(process.env.DKG_API_TOKEN_FILE || "/root/.dkg/auth.token", "utf8")
      .split(/\n/).find((line) => line.trim() && !line.trim().startsWith("#"))?.trim();
    if (!token) throw new Error("DKG token unavailable");
    const response = await fetch(`${DKG_API}/api/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contextGraphId: GRAPH_ID, view: "shared-working-memory",
        sparql: "SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { ?s <https://schema.org/articleBody> ?body }" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`DKG query ${response.status}`);
    const body = await response.json();
    const value = body?.result?.bindings?.[0]?.count;
    const count = Number(String(value).match(/^"(\d+)"/)?.[1]);
    if (!Number.isSafeInteger(count)) throw new Error("DKG count unavailable");
    sharedStats = { count, expiresAt: Date.now() + 300000 };
    return count;
  })().finally(() => { sharedStatsRefresh = undefined; });
  try { return await sharedStatsRefresh; }
  catch { return sharedStats.count; }
}

const PORT = Number(process.env.SWARM_WEBHOOK_PORT || 27132);
const HOST = process.env.SWARM_WEBHOOK_HOST || "127.0.0.1";
const SECRET = process.env.SWARM_KEY_SECRET || "";
const ADMIN = process.env.SWARM_ADMIN_TOKEN || "";
const STORE = process.env.SWARM_STORE || "/root/dkg-swarm-webhooks/data/registry.json";
const FAIL_DISABLE = Number(process.env.SWARM_FAIL_DISABLE || 5);
const ACTIONS = new Set([
  "collective_push",
  "make_it_trend",
  "amplify_official",
  "reply_wave",
  "recruit_wave",
  "metric_blast",
  "sync_context",
  "custom",
]);

function keyBuf() {
  return crypto.scryptSync(SECRET, "dkgswarm-webhooks-v1", 32);
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function decrypt(blob) {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
function maskKey(plain) {
  const s = String(plain || "");
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return { endpoints: [] };
  }
}
function saveDb(db) {
  fs.mkdirSync("/root/dkg-swarm-webhooks/data", { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function validateWebhookUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not valid");
  }
  if (u.protocol !== "https:") throw new Error("Webhook URL must be https");
  if (isPrivateHost(u.hostname)) throw new Error("Webhook URL host is not allowed");
  return u.toString();
}

function publicRow(row) {
  return {
    id: row.id,
    handle: row.handle || "",
    botName: row.botName || "",
    urlHost: (() => {
      try {
        return new URL(row.url).host;
      } catch {
        return "";
      }
    })(),
    keyMasked: row.keyMasked,
    createdAt: row.createdAt,
    disabled: !!row.disabled,
    failCount: row.failCount || 0,
    lastStatus: row.lastStatus || null,
    lastSentAt: row.lastSentAt || null,
  };
}

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "https://www.dkgswarm.com");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Swarm-Admin");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/api/swarm/health", (_req, res) => {
  const db = loadDb();
  res.json({ ok: true, registered: (db.endpoints || []).filter((e) => !e.disabled).length });
});

app.get("/api/swarm/stats", async (_req, res) => {
  try {
    const sharedPosts = await sharedPostCount();
    if (sharedPosts === null) throw new Error("shared memory unavailable");
    const sources = watcher.status().queue.find((row) => row.stage === "raw-dkg" && row.status === "completed")?.count || 0;
    res.set("Cache-Control", "public, max-age=300");
    res.json({ collectedSources: sources, sharedPosts });
  } catch {
    res.status(503).json({ error: "Swarm stats temporarily unavailable" });
  }
});

app.post("/api/swarm/register", (req, res) => {
  res.status(410).json({ ok: false, error: "Webhook registration retired; use scheduled DKG reads." });
});

function requireAdmin(req, res, next) {
  const got = (req.get("x-swarm-admin") || req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN || got !== ADMIN) {
    res.status(401).json({ ok: false, error: "admin token required" });
    return;
  }
  next();
}

app.get("/api/swarm/admin", requireAdmin, (_req, res) => {
  const db = loadDb();
  res.json({ ok: true, endpoints: (db.endpoints || []).map(publicRow) });
});

app.post("/api/swarm/admin/revoke", requireAdmin, (req, res) => {
  const id = String(req.body?.id || "");
  const db = loadDb();
  const row = (db.endpoints || []).find((e) => e.id === id);
  if (!row) return res.status(404).json({ ok: false, error: "not found" });
  row.disabled = true;
  row.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json({ ok: true });
});

async function deliver(row, payload) {
  const key = decrypt(row.keyEnc);
  const body = JSON.stringify(payload);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(row.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: ctrl.signal,
    });
    return { status: r.status, ok: r.status === 200 };
  } catch (err) {
    return { status: 0, ok: false, error: String(err.message || err) };
  } finally {
    clearTimeout(t);
  }
}

async function fanout(payload) {
  const action = String(payload.action || "collective_push");
  if (!ACTIONS.has(action)) throw new Error("unknown action");
  const db = loadDb();
  const live = (db.endpoints || []).filter((e) => !e.disabled);
  const results = [];
  for (const row of live) {
    let last = { ok: false, status: 0 };
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = await deliver(row, payload);
      if (last.ok) break;
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
    }
    row.lastStatus = last.status;
    row.lastSentAt = new Date().toISOString();
    if (last.ok) row.failCount = 0;
    else {
      row.failCount = (row.failCount || 0) + 1;
      if (row.failCount >= FAIL_DISABLE) row.disabled = true;
    }
    results.push({ id: row.id, handle: row.handle, ok: last.ok, status: last.status, disabled: row.disabled });
  }
  saveDb(db);
  return { sent: results.length, results };
}

app.post("/api/swarm/fanout", requireAdmin, async (req, res) => {
  res.status(410).json({ ok: false, error: "Webhook fan-out retired; agents read Shared Working Memory on schedule." });
});

const watcher = createWatcher({
  fanout,
  log: console,
  getAdditionalAccounts() {
    return (loadDb().endpoints || []).filter((row) => !row.disabled).map((row) => row.handle);
  },
});

app.get("/api/swarm/watcher", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...watcher.status() });
});

app.post("/api/swarm/watcher/test", requireAdmin, async (req, res) => {
  res.status(410).json({ ok: false, error: "Webhook test retired." });
});

app.listen(PORT, HOST, () => {
  console.log(`swarm webhooks http://${HOST}:${PORT}`);
  watcher.start();
});
