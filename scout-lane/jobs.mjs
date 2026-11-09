// Opt-in scout -> worker job lane for trac-marketing.
// Authoritative transactional state is local SQLite: the DKG API has no
// compare-and-swap, so a graph write can never be the claim ledger.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const ACTIONS = new Set(["original", "reply", "quote"]);
export const STATES = new Set(["queued", "claimed", "draft", "completed", "published", "failed", "skipped", "uncertain", "expired"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BRIEF = 1200;
const MAX_TEXT = 2000;
const DISALLOWED = /(?:^|[^a-z])(like|repost|retweet|boost|upvote|downvote|follow|dm|direct[- ]message|vote)(?:[^a-z]|$)/i;
const PROHIBITED = /create (?:an )?account|sign ?up|log ?in|captcha|bypass|circumvent|mass (?:follow|dm)|send (?:a )?dm|scrape private/i;
const SENSITIVE = /(?:password|passwd|secret|api[ _-]?key|bearer\s+[a-z0-9._-]{10,}|session[ _-]?cookie|\bdm\b|private message|\b(?:sk|pk|ghp|xox[baprs])[-_][a-z0-9]{10,})/i;
const INJECTION = /ignore (?:all )?(?:previous|prior|above) instructions|system prompt|developer message|you are now (?:a|an|the)\b/i;

export class LaneError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object") throw new LaneError("config", "config must be an object");
  const mode = raw.mode ?? "off";
  if (!["off", "dry-run", "live"].includes(mode)) throw new LaneError("config", "mode must be off, dry-run or live");
  if (mode === "live" && !raw.scoutModel) throw new LaneError("model-unconfigured", "live mode requires a verified scoutModel id");
  if (!raw.graph || raw.graph.contextGraphId !== "trac-marketing") throw new LaneError("config", "graph.contextGraphId must be trac-marketing");
  if (typeof raw.operatorOptIn !== "boolean") throw new LaneError("config", "operatorOptIn must be boolean");
  return {
    mode,
    operatorOptIn: raw.operatorOptIn,
    scoutModel: raw.scoutModel ?? null,
    graph: {
      contextGraphId: "trac-marketing",
      subGraphName: raw.graph.subGraphName ?? "scout-jobs",
      view: raw.graph.view ?? "shared-working-memory",
      mirrorEnabled: raw.graph.mirrorEnabled === true,
    },
    publish: {
      defaultMode: raw.publish?.defaultMode === "preauthorized" ? "preauthorized" : "draft",
      preauthorized: raw.publish?.preauthorized === true,
      allowedMethods: Array.isArray(raw.publish?.allowedMethods) ? raw.publish.allowedMethods : ["manual"],
    },
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    limits: {
      leaseMinutes: positive(raw.limits?.leaseMinutes, 10, 1, 120),
      jobTtlMinutes: positive(raw.limits?.jobTtlMinutes, 120, 5, 24 * 60),
      failureCooldownMinutes: positive(raw.limits?.failureCooldownMinutes, 360, 5, 7 * 24 * 60),
      maxClaimsPerDay: positive(raw.limits?.maxClaimsPerDay, 10, 1, 100),
      maxPerAccountPerDay: positive(raw.limits?.maxPerAccountPerDay, 3, 1, 20),
      maxBriefsPerRun: positive(raw.limits?.maxBriefsPerRun, 5, 1, 20),
    },
    roles: {
      scouts: array(raw.roles?.scouts),
      workers: array(raw.roles?.workers),
      publishers: array(raw.roles?.publishers),
      operators: array(raw.roles?.operators),
    },
    tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : {},
  };
}

function positive(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function array(value) { return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v) : []; }

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL,
      state TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'scout',
      platform TEXT NOT NULL,
      action TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'manual',
      account_scope TEXT NOT NULL,
      target_url TEXT,
      topic TEXT NOT NULL,
      brief TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      relevance REAL NOT NULL,
      publish_mode TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      claimed_at INTEGER,
      lease_until INTEGER,
      worker_id TEXT,
      fencing_token INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      result_url TEXT,
      result_status TEXT,
      reason TEXT,
      content TEXT,
      outcome_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe
      ON jobs(dedupe_key) WHERE state IN ('queued','claimed','draft','uncertain');
    CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, expires_at);
    CREATE TABLE IF NOT EXISTS cooldowns (
      dedupe_key TEXT PRIMARY KEY,
      until INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
  `);
  return db;
}

export function canonicalPublicUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new LaneError("invalid-url", "source URL is not a URL"); }
  if (url.protocol !== "https:") throw new LaneError("invalid-url", "only public https URLs are allowed");
  if (url.username || url.password) throw new LaneError("invalid-url", "URLs with credentials are refused");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "localhost" || host.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "[::1]") {
    throw new LaneError("invalid-url", "private or local URLs are refused");
  }
  if (host === "x.com" || host === "twitter.com") {
    if (/^\/(?:messages|i\/chat|dm)/i.test(url.pathname)) throw new LaneError("private-surface", "private messages are out of scope");
    const m = url.pathname.match(/^\/(?:i\/)?(?:[^/]+\/)?status\/(\d+)$/);
    if (m) return `https://x.com/i/status/${m[1]}`;
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ref_src$)/i.test(key)) url.searchParams.delete(key);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function cleanText(value, field, min, max) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) throw new LaneError("invalid-opportunity", `${field} must be ${min}-${max} characters`);
  return text;
}

export function validateOpportunity(opportunity, config, now = Date.now()) {
  if (!opportunity || typeof opportunity !== "object") throw new LaneError("invalid-opportunity", "opportunity must be an object");
  if (opportunity.abstain === true) {
    return { abstain: true, reason: cleanText(opportunity.reason ?? "no suitable opportunity", "reason", 3, 300) };
  }
  const platform = String(opportunity.platform ?? "x").toLowerCase();
  if (platform !== "x") throw new LaneError("unsupported-platform", "only X is supported by this pilot");
  const action = String(opportunity.action ?? "");
  if (!ACTIONS.has(action)) throw new LaneError("unsupported-action", "action must be original, reply or quote");
  const accountScope = cleanText(opportunity.accountScope, "accountScope", 3, 80);
  if (!config.accounts.includes(accountScope)) throw new LaneError("unapproved-account", "account is not in the operator allowlist");
  const topic = cleanText(opportunity.topic, "topic", 3, 120);
  if (DISALLOWED.test(topic)) throw new LaneError("disallowed-action", "engagement or direct-message jobs are out of scope");
  const method = String(opportunity.method ?? "manual");
  if (!config.publish.allowedMethods.includes(method)) throw new LaneError("unapproved-method", "method is not operator-approved");
  const brief = cleanText(opportunity.brief, "brief", 20, MAX_BRIEF);
  if (PROHIBITED.test(`${topic} ${brief}`)) throw new LaneError("disallowed-action", "login, CAPTCHA, account creation, spam or circumvention is out of scope");
  let targetUrl = null;
  if (action !== "original") {
    if (!opportunity.targetUrl) throw new LaneError("missing-target", "reply and quote require a public target URL");
    targetUrl = canonicalPublicUrl(opportunity.targetUrl);
  }
  const sources = Array.isArray(opportunity.sources) ? opportunity.sources.slice(0, 5) : [];
  if (!sources.length) throw new LaneError("missing-provenance", "at least one public source is required");
  const provenance = sources.map((source) => ({
    url: canonicalPublicUrl(source?.url),
    note: source?.note ? cleanText(source.note, "source note", 1, 240) : null,
  }));
  const evidence = [];
  for (const item of (Array.isArray(opportunity.evidence) ? opportunity.evidence.slice(0, 5) : [])) {
    evidence.push({
      url: canonicalPublicUrl(item?.url),
      text: item?.text ? cleanText(item.text, "evidence text", 1, MAX_TEXT) : null,
    });
  }
  const relevance = Number(opportunity.relevance ?? 0.5);
  if (!Number.isFinite(relevance) || relevance < 0 || relevance > 1) throw new LaneError("invalid-opportunity", "relevance must be 0..1");
  const text = JSON.stringify([brief, topic, ...evidence.map((e) => e.text || "")]);
  const expiresAt = Number.isFinite(Date.parse(opportunity.expiresAt))
    ? Date.parse(opportunity.expiresAt)
    : now + config.limits.jobTtlMinutes * 60_000;
  if (expiresAt <= now) throw new LaneError("expired-opportunity", "opportunity is already expired");
  return {
    abstain: false,
    platform, action, method, accountScope, topic, brief, targetUrl, provenance, evidence, relevance: Math.round(relevance * 1000) / 1000,
    observedAt: Number.isFinite(Date.parse(opportunity.observedAt)) ? new Date(Date.parse(opportunity.observedAt)).toISOString() : new Date(now).toISOString(),
    expiresAt,
    sensitiveFlag: SENSITIVE.test(text),
    injectionFlag: INJECTION.test(text),
  };
}

export function dedupeKey(job) {
  const material = [job.source ?? "scout", job.platform, job.action, job.accountScope, job.targetUrl || job.topic.toLowerCase()];
  return createHash("sha256").update(material.join("\n")).digest("hex");
}

function assertEnabled(config) {
  if (config.mode === "off") throw new LaneError("opt-in-required", "scout lane is disabled");
  if (!config.operatorOptIn) throw new LaneError("opt-in-required", "operator opt-in is not recorded");
}

function authenticate(config, role, id, token) {
  if (!config.roles[role].includes(id)) throw new LaneError("unauthorized", `unknown ${role}`);
  const spec = config.tokens?.[role]?.[id];
  const expected = spec?.env ? process.env[spec.env] : undefined;
  const supplied = String(token ?? "");
  if (!expected || !supplied || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    throw new LaneError("unauthorized", `invalid ${role} credential`);
  }
}

function ensureLease(db, now) {
  db.prepare("UPDATE jobs SET state='queued', lease_until=NULL, worker_id=NULL, revision=revision+1, updated_at=? WHERE state='claimed' AND lease_until < ?").run(now, now);
  db.prepare("UPDATE jobs SET state='expired', lease_until=NULL, revision=revision+1, updated_at=? WHERE state='queued' AND expires_at <= ?").run(now, now);
}

function cooldownActive(db, key, now) {
  const row = db.prepare("SELECT until FROM cooldowns WHERE dedupe_key = ?").get(key);
  return row && row.until > now ? row : null;
}

export function enqueue({ dbPath, configPath, scoutId, scoutToken, opportunity, now = Date.now() }) {
  const config = loadConfig(configPath);
  assertEnabled(config);
  authenticate(config, "scouts", scoutId, scoutToken);
  const db = openDb(dbPath);
  try {
    ensureLease(db, now);
    const normalized = validateOpportunity(opportunity, config, now);
    if (normalized.abstain) return { accepted: false, abstained: true, reason: normalized.reason };
    const base = {
      source: "scout", platform: normalized.platform, action: normalized.action,
      accountScope: normalized.accountScope, targetUrl: normalized.targetUrl, topic: normalized.topic,
    };
    const key = dedupeKey(base);
    const cooldown = cooldownActive(db, key, now);
    if (cooldown) return { accepted: false, duplicate: true, cooldownUntil: cooldown.until };
    const active = db.prepare("SELECT id FROM jobs WHERE dedupe_key = ? AND state IN ('queued','claimed','draft','uncertain')").get(key);
    if (active) return { accepted: false, duplicate: true, jobId: active.id };
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO jobs
        (id,dedupe_key,state,source,platform,action,method,account_scope,target_url,topic,brief,provenance_json,relevance,publish_mode,created_at,updated_at,expires_at,outcome_json)
        VALUES (?,?,'queued','scout',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, key, normalized.platform, normalized.action, normalized.method, normalized.accountScope, normalized.targetUrl,
        normalized.topic, normalized.brief, JSON.stringify({ sources: normalized.provenance, evidence: normalized.evidence, observedAt: normalized.observedAt, sensitiveFlag: normalized.sensitiveFlag, injectionFlag: normalized.injectionFlag }),
        normalized.relevance, config.publish.defaultMode, now, now, normalized.expiresAt, null,
      );
    } catch (error) {
      if (/UNIQUE/.test(error.message)) return { accepted: false, duplicate: true };
      throw error;
    }
    return { accepted: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)) };
  } finally { db.close(); }
}

export function claim({ dbPath, configPath, workerId, workerToken, now = Date.now() }) {
  const config = loadConfig(configPath);
  assertEnabled(config);
  authenticate(config, "workers", workerId, workerToken);
  const db = openDb(dbPath);
  try {
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const claimedToday = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE worker_id = ? AND claimed_at >= ?").get(workerId, dayStart).n;
    if (claimedToday >= config.limits.maxClaimsPerDay) return { claimed: false, throttled: true, reason: "daily claim limit" };
    ensureLease(db, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM jobs WHERE state='queued' AND expires_at > ? ORDER BY relevance DESC, created_at ASC LIMIT 1").get(now);
      if (!row) { db.exec("COMMIT"); return { claimed: false, reason: "no eligible job" }; }
      const leaseUntil = now + config.limits.leaseMinutes * 60_000;
      const changed = db.prepare(`UPDATE jobs SET state='claimed', worker_id=?, claimed_at=?, lease_until=?, fencing_token=fencing_token+1,
        revision=revision+1, attempts=attempts+1, updated_at=? WHERE id=? AND state='queued'`).run(workerId, now, leaseUntil, now, row.id).changes;
      if (changed !== 1) { db.exec("ROLLBACK"); return { claimed: false, reason: "claim lost" }; }
      db.exec("COMMIT");
      const job = publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id));
      return { claimed: true, job, fencingToken: job.fencingToken, revision: job.revision, leaseUntil };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function preflight(job, config, now = Date.now()) {
  const checks = {
    optIn: config.mode !== "off" && config.operatorOptIn,
    notExpired: job.expiresAt > now,
    leaseLive: job.state === "claimed" && job.leaseUntil > now,
    xOnly: job.platform === "x",
    allowedAction: ACTIONS.has(job.action) && !DISALLOWED.test(`${job.action} ${job.topic}`),
    approvedAccount: config.accounts.includes(job.accountScope),
    approvedMethod: config.publish.allowedMethods.includes(job.method ?? "manual"),
    publishAllowed: job.publishMode !== "preauthorized" || config.publish.preauthorized === true,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function report({ dbPath, configPath, workerId, workerToken, publisherId, publisherToken, jobId, fencingToken, revision, status, resultUrl, resultStatus, reason, content, now = Date.now() }) {
  const config = loadConfig(configPath);
  assertEnabled(config);
  authenticate(config, "workers", workerId, workerToken);
  if (!["completed", "drafted", "published", "failed", "skipped", "uncertain"].includes(status)) throw new LaneError("invalid-status", "unsupported report status");
  if (status === "published") {
    authenticate(config, "publishers", publisherId, publisherToken);
    if (!config.publish.preauthorized) throw new LaneError("publish-not-authorized", "publisher authority is not enabled by the operator");
  }
  if (["completed", "published"].includes(status)) {
    if (!resultUrl) throw new LaneError("missing-result", "completed or published requires a permalink");
    resultUrl = canonicalPublicUrl(resultUrl);
    if (!resultStatus) throw new LaneError("missing-result", "resultStatus is required");
  }
  if (status === "drafted") content = cleanText(content, "content", 20, MAX_TEXT);
  if (["failed", "skipped", "uncertain"].includes(status)) reason = cleanText(reason ?? "", "reason", 3, 300);
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (!job) { db.exec("ROLLBACK"); return { ok: false, code: "not-found" }; }
      const stale = job.state !== "claimed" || job.worker_id !== workerId || job.fencing_token !== Number(fencingToken) ||
        job.revision !== Number(revision) || job.lease_until < now;
      if (stale) { db.exec("ROLLBACK"); return { ok: false, code: "stale", state: job.state }; }
      if (status === "published" && job.publish_mode !== "preauthorized") {
        db.exec("ROLLBACK");
        throw new LaneError("publish-mode", "job is draft-only; leave it as draft");
      }
      const publishCount = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_scope = ? AND state='published' AND updated_at >= ?").get(job.account_scope, Math.floor(now / DAY_MS) * DAY_MS).n;
      if (status === "published" && publishCount >= config.limits.maxPerAccountPerDay) {
        db.exec("ROLLBACK");
        return { ok: false, code: "limit", reason: "per-account daily publish limit" };
      }
      const state = status === "completed" ? "completed" : status === "drafted" ? "draft" : status === "published" ? "published" : status;
      db.prepare(`UPDATE jobs SET state=?, revision=revision+1, lease_until=NULL, result_url=?, result_status=?, reason=?, content=COALESCE(?,content), updated_at=? WHERE id=?`).run(
        state, resultUrl ?? null, resultStatus ?? null, reason ?? null, content ?? null, now, jobId,
      );
      if (["completed", "published", "failed", "skipped"].includes(status)) {
        const until = now + config.limits.failureCooldownMinutes * 60_000;
        db.prepare(`INSERT INTO cooldowns (dedupe_key,until,reason) VALUES (?,?,?)
          ON CONFLICT(dedupe_key) DO UPDATE SET until=excluded.until, reason=excluded.reason`).run(job.dedupe_key, until, status);
      }
      db.exec("COMMIT");
      return { ok: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)) };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function publish({ dbPath, configPath, publisherId, publisherToken, jobId, resultUrl, resultStatus, now = Date.now() }) {
  const config = loadConfig(configPath);
  assertEnabled(config);
  authenticate(config, "publishers", publisherId, publisherToken);
  if (!config.publish.preauthorized) throw new LaneError("publish-not-authorized", "publisher authority is not enabled by the operator");
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (!job) { db.exec("ROLLBACK"); return { ok: false, code: "not-found" }; }
      if (job.state !== "draft" || job.publish_mode !== "preauthorized" || job.expires_at <= now) {
        db.exec("ROLLBACK"); return { ok: false, code: "not-publishable", state: job.state };
      }
      const url = canonicalPublicUrl(resultUrl);
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const n = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_scope = ? AND state='published' AND updated_at >= ?").get(job.account_scope, dayStart).n;
      if (n >= config.limits.maxPerAccountPerDay) { db.exec("ROLLBACK"); return { ok: false, code: "limit", reason: "per-account daily publish limit" }; }
      db.prepare("UPDATE jobs SET state='published', revision=revision+1, result_url=?, result_status=?, updated_at=? WHERE id=?").run(url, String(resultStatus || "published"), now, jobId);
      db.prepare(`INSERT INTO cooldowns (dedupe_key,until,reason) VALUES (?,?,?)
        ON CONFLICT(dedupe_key) DO UPDATE SET until=excluded.until, reason=excluded.reason`).run(job.dedupe_key, now + config.limits.failureCooldownMinutes * 60_000, "published");
      db.exec("COMMIT");
      return { ok: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)) };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function resolveUncertain({ dbPath, configPath, operatorId, operatorToken, jobId, resolution, resultUrl, reason, now = Date.now() }) {
  const config = loadConfig(configPath);
  assertEnabled(config);
  authenticate(config, "operators", operatorId, operatorToken);
  if (!["verified", "retry", "reject"].includes(resolution)) throw new LaneError("invalid-resolution", "resolution must be verified, retry or reject");
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (!job || job.state !== "uncertain") { db.exec("ROLLBACK"); return { ok: false, code: "not-uncertain" }; }
      if (resolution === "retry") {
        db.prepare("UPDATE jobs SET state='queued', revision=revision+1, worker_id=NULL, lease_until=NULL, updated_at=? WHERE id=?").run(now, jobId);
      } else {
        const url = resolution === "verified" && resultUrl ? canonicalPublicUrl(resultUrl) : null;
        db.prepare("UPDATE jobs SET state=?, revision=revision+1, result_url=?, reason=?, updated_at=? WHERE id=?").run(
          resolution === "verified" ? "completed" : "skipped", url, cleanText(reason ?? resolution, "reason", 3, 300), now, jobId,
        );
        db.prepare(`INSERT INTO cooldowns (dedupe_key,until,reason) VALUES (?,?,?)
          ON CONFLICT(dedupe_key) DO UPDATE SET until=excluded.until, reason=excluded.reason`).run(job.dedupe_key, now + config.limits.failureCooldownMinutes * 60_000, `uncertain-${resolution}`);
      }
      db.exec("COMMIT");
      return { ok: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)) };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function listJobs({ dbPath, state, limit = 20, now = Date.now() }) {
  const db = openDb(dbPath);
  try {
    ensureLease(db, now);
    const rows = state
      ? db.prepare("SELECT * FROM jobs WHERE state = ? ORDER BY updated_at DESC LIMIT ?").all(state, Math.min(100, limit))
      : db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?").all(Math.min(100, limit));
    return rows.map(publicJob);
  } finally { db.close(); }
}

export function expireJobs({ dbPath, now = Date.now() }) {
  const db = openDb(dbPath);
  try { ensureLease(db, now); return { ok: true }; } finally { db.close(); }
}

export function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    state: row.state,
    source: row.source,
    platform: row.platform,
    action: row.action,
    method: row.method,
    accountScope: row.account_scope,
    targetUrl: row.target_url,
    topic: row.topic,
    brief: row.brief,
    provenance: JSON.parse(row.provenance_json || "{}"),
    relevance: row.relevance,
    publishMode: row.publish_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    leaseUntil: row.lease_until,
    fencingToken: row.fencing_token,
    revision: row.revision,
    attempts: row.attempts,
    resultUrl: row.result_url,
    resultStatus: row.result_status,
    reason: row.reason,
    content: row.content,
  };
}
