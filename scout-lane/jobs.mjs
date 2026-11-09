// Opt-in scout -> worker job lane for trac-marketing.
// SQLite is the authoritative claim ledger: the live DKG API has no CAS.
// Remote MCP handlers bind authority to an OAuth token family; this module
// exposes core operations plus token-authenticated wrappers for the local CLI.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const ACTIONS = new Set(["original", "reply", "quote"]);
export const REPORT_STATUSES = new Set(["drafted", "published", "failed", "skipped", "uncertain"]);
const ACTIVE_STATES = "('queued','claimed','submitting','draft','uncertain')";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BRIEF = 1200;
const MAX_TEXT = 2000;
const MAX_SUMMARY_TOPIC = 120;
const DISALLOWED = /(?:^|[^a-z])(like|repost|retweet|boost|upvote|downvote|follow|dm|direct[- ]message|vote)(?:[^a-z]|$)/i;
const PROHIBITED = /create (?:an )?account|sign ?up|log ?in|captcha|bypass|circumvent|mass (?:follow|dm)|send (?:a )?dm|\bdm\b|scrape private/i;
const SENSITIVE = /(?:password|passwd|secret|bearer\s+[a-z0-9._-]{10,}|session[ _-]?cookie|\b(?:sk|pk|ghp|xox[baprs])[-_][a-z0-9]{10,})/i;
const INJECTION = /ignore (?:all )?(?:previous|prior|above) instructions|system prompt|developer message|you are now (?:a|an|the)\b/i;

export class LaneError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function positive(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function array(value) { return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v) : []; }

export function loadConfig(path, { now = Date.now(), isModelAvailable } = {}) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object") throw new LaneError("config", "config must be an object");
  const mode = raw.mode ?? "off";
  if (!["off", "dry-run", "live"].includes(mode)) throw new LaneError("config", "mode must be off, dry-run or live");
  if (!raw.graph || raw.graph.contextGraphId !== "trac-marketing") throw new LaneError("config", "graph.contextGraphId must be trac-marketing");
  if (typeof raw.operatorOptIn !== "boolean") throw new LaneError("config", "operatorOptIn must be boolean");
  const availableModels = array(raw.availableModels);
  const availableModelsVerifiedAt = Date.parse(raw.availableModelsVerifiedAt || "");
  const approvedModels = array(raw.approvedModels);
  const scoutModel = raw.scoutModel == null ? null : String(raw.scoutModel);
  const modelCheck = isModelAvailable || ((id) => {
    if (!availableModelsVerifiedAt || now - availableModelsVerifiedAt > DAY_MS) return false;
    return availableModels.includes(id);
  });
  if (mode === "live") {
    if (!scoutModel || !scoutModel.includes("/") || /REQUIRED|PLACEHOLDER|CHANGEME/i.test(scoutModel)) {
      throw new LaneError("model-unconfigured", "live mode requires an exact verified scoutModel id");
    }
    if (!approvedModels.includes(scoutModel)) throw new LaneError("model-unapproved", "scoutModel is not explicitly operator-approved");
    if (!modelCheck(scoutModel)) throw new LaneError("model-unavailable", "scoutModel is not in the verified provider catalog");
  }
  return {
    mode,
    operatorOptIn: raw.operatorOptIn,
    scoutModel,
    approvedModels,
    availableModels,
    availableModelsVerifiedAt: Number.isFinite(availableModelsVerifiedAt) ? availableModelsVerifiedAt : null,
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
    accounts: array(raw.accounts),
    limits: {
      leaseMinutes: positive(raw.limits?.leaseMinutes, 10, 1, 120),
      jobTtlMinutes: positive(raw.limits?.jobTtlMinutes, 120, 5, 24 * 60),
      maxJobTtlMinutes: positive(raw.limits?.maxJobTtlMinutes, 24 * 60, 5, 7 * 24 * 60),
      submitTimeoutMinutes: positive(raw.limits?.submitTimeoutMinutes, 5, 1, 60),
      failureCooldownMinutes: positive(raw.limits?.failureCooldownMinutes, 360, 5, 7 * 24 * 60),
      maxClaimsPerDay: positive(raw.limits?.maxClaimsPerDay, 10, 1, 100),
      maxBriefsPerDay: positive(raw.limits?.maxBriefsPerDay, 20, 1, 100),
      maxBriefsPerRun: positive(raw.limits?.maxBriefsPerRun, 5, 1, 20),
      maxPerAccountPerDay: positive(raw.limits?.maxPerAccountPerDay, 3, 1, 20),
    },
    roles: {
      scouts: array(raw.roles?.scouts), workers: array(raw.roles?.workers),
      publishers: array(raw.roles?.publishers), operators: array(raw.roles?.operators),
    },
    tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : {},
  };
}

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
      submit_token TEXT,
      submit_started_at INTEGER,
      submit_deadline INTEGER,
      quota_reserved INTEGER NOT NULL DEFAULT 0,
      quota_day INTEGER,
      quota_scope TEXT,
      receipt_json TEXT,
      result_url TEXT,
      result_status TEXT,
      reason TEXT,
      content TEXT,
      outcome_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe
      ON jobs(dedupe_key) WHERE state IN ${ACTIVE_STATES};
    CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, expires_at);
    CREATE TABLE IF NOT EXISTS daily_quota (
      day INTEGER NOT NULL,
      scope TEXT NOT NULL,
      used INTEGER NOT NULL,
      PRIMARY KEY(day, scope)
    );
    CREATE TABLE IF NOT EXISTS cooldowns (
      dedupe_key TEXT PRIMARY KEY,
      until INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(jobs)").all().map((row) => row.name));
  if (!columns.has("quota_day")) db.exec("ALTER TABLE jobs ADD COLUMN quota_day INTEGER");
  if (!columns.has("quota_scope")) db.exec("ALTER TABLE jobs ADD COLUMN quota_scope TEXT");
  return db;
}

function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home") || host.endsWith(".lan") || host.endsWith(".invalid") || host.endsWith(".test")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return false;
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host)) return false;
    if (host.startsWith("::ffff:")) {
      const tail = host.slice(7);
      return /^\d+\.\d+\.\d+\.\d+$/.test(tail) ? assertPublicHost(tail) : false;
    }
    if (/^2001:db8:/.test(host)) return false;
  }
  return /^[a-z0-9.-]+$/.test(host);
}

const SECRET_QUERY = /^(?:api[_-]?key|token|access[_-]?token|id[_-]?token|secret|password|passwd|sig|signature|auth|authorization|session|session[_-]?id|key)$/i;
export function queryHasSecret(value) {
  try {
    const url = new URL(String(value));
    for (const [key, val] of url.searchParams) {
      if (SECRET_QUERY.test(key)) return true;
      if (SENSITIVE.test(`${key}=${val}`)) return true;
    }
  } catch { return true; }
  return false;
}

export function canonicalPublicUrl(value, { requireFetchable = false } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new LaneError("invalid-url", "source URL is not a URL"); }
  if (url.protocol !== "https:") throw new LaneError("invalid-url", "only public https URLs are allowed");
  if (url.username || url.password) throw new LaneError("invalid-url", "URLs with credentials are refused");
  if (url.port && !["", "443"].includes(url.port)) throw new LaneError("invalid-url", "non-standard ports are refused");
  if (!assertPublicHost(url.hostname)) throw new LaneError("private-url", "private, local or reserved host is refused");
  if (requireFetchable && (url.hostname.endsWith(".invalid") || url.hostname.endsWith(".test"))) throw new LaneError("private-url", "non-routable fixture host is not fetchable");
  if (queryHasSecret(url)) throw new LaneError("secret-url", "URL query contains credential-like material");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
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
  const sensitiveFlag = SENSITIVE.test(text);
  if (sensitiveFlag) throw new LaneError("sensitive-input", "opportunity contains credential-like material");
  const expiresAt = Number.isFinite(Date.parse(opportunity.expiresAt))
    ? Date.parse(opportunity.expiresAt)
    : now + config.limits.jobTtlMinutes * 60_000;
  if (expiresAt <= now) throw new LaneError("expired-opportunity", "opportunity is already expired");
  if (expiresAt > now + config.limits.maxJobTtlMinutes * 60_000) throw new LaneError("expiry-too-distant", "opportunity expiry exceeds the configured maximum lifetime");
  for (const source of provenance) if (queryHasSecret(source.url)) throw new LaneError("secret-url", "source URL query contains credential-like material");
  return {
    abstain: false,
    platform, action, method, accountScope, topic, brief, targetUrl, provenance, evidence,
    relevance: Math.round(relevance * 1000) / 1000,
    observedAt: Number.isFinite(Date.parse(opportunity.observedAt)) ? new Date(Date.parse(opportunity.observedAt)).toISOString() : new Date(now).toISOString(),
    expiresAt,
    sensitiveFlag,
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

function assertLive(config) {
  assertEnabled(config);
  if (config.mode !== "live") throw new LaneError("live-only", "external submission is available only in live mode");
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

function sameSecret(a, b) {
  const left = String(a ?? ""), right = String(b ?? "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function dayStart(now) { return Math.floor(now / DAY_MS) * DAY_MS; }

function reserveQuota(db, now, scope, limit) {
  const result = db.prepare(`INSERT INTO daily_quota(day,scope,used) VALUES(?,?,1)
    ON CONFLICT(day,scope) DO UPDATE SET used=used+1 WHERE used < ?`).run(dayStart(now), scope, limit);
  return result.changes === 1;
}

function cooldownActive(db, key, now) {
  const row = db.prepare("SELECT until FROM cooldowns WHERE dedupe_key = ?").get(key);
  return row && row.until > now ? row : null;
}

export function maintenanceCore(db, config, now = Date.now()) {
  db.prepare("UPDATE jobs SET state='queued', lease_until=NULL, worker_id=NULL, revision=revision+1, updated_at=? WHERE state='claimed' AND lease_until < ?").run(now, now);
  db.prepare("UPDATE jobs SET state='expired', lease_until=NULL, revision=revision+1, updated_at=? WHERE state IN ('queued','draft') AND expires_at <= ?").run(now, now);
  db.prepare("UPDATE jobs SET state='uncertain', lease_until=NULL, revision=revision+1, reason=COALESCE(reason,'submit time expired before receipt'), updated_at=? WHERE state='submitting' AND submit_deadline < ?").run(now, now);
  db.prepare("DELETE FROM cooldowns WHERE until <= ?").run(now);
  return db;
}

function accountFilter(accounts) {
  const list = array(accounts);
  if (!list.length) return null;
  return list;
}

export function enqueueBatchCore({ dbPath, config, scoutId, opportunities, accounts, now = Date.now() }) {
  assertEnabled(config);
  if (!Array.isArray(opportunities) || !opportunities.length) throw new LaneError("invalid-batch", "opportunities must be a non-empty array");
  if (opportunities.length > config.limits.maxBriefsPerRun) throw new LaneError("batch-too-large", "scout run exceeds maxBriefsPerRun");
  const allowedAccounts = accounts ? array(accounts) : config.accounts;
  const db = openDb(dbPath);
  const accepted = [];
  const rejected = [];
  try {
    maintenanceCore(db, config, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const opportunity of opportunities) {
        try {
          const normalized = validateOpportunity(opportunity, config, now);
          if (normalized.abstain) { rejected.push({ abstained: true, reason: normalized.reason }); continue; }
          if (!allowedAccounts.includes(normalized.accountScope)) throw new LaneError("unapproved-account", "account is outside this scout grant");
          const base = {
            source: "scout", platform: normalized.platform, action: normalized.action,
            accountScope: normalized.accountScope, targetUrl: normalized.targetUrl, topic: normalized.topic,
          };
          const key = dedupeKey(base);
          const cooldown = cooldownActive(db, key, now);
          if (cooldown) { rejected.push({ duplicate: true, cooldownUntil: cooldown.until }); continue; }
          const active = db.prepare(`SELECT id FROM jobs WHERE dedupe_key = ? AND state IN ${ACTIVE_STATES}`).get(key);
          if (active) { rejected.push({ duplicate: true, jobId: active.id }); continue; }
          if (!reserveQuota(db, now, `briefs:${scoutId}`, config.limits.maxBriefsPerDay)) throw new LaneError("brief-quota", "daily scout brief limit reached");
          const id = randomUUID();
          db.prepare(`INSERT INTO jobs
            (id,dedupe_key,state,source,platform,action,method,account_scope,target_url,topic,brief,provenance_json,relevance,publish_mode,created_at,updated_at,expires_at,outcome_json)
            VALUES (?,?,'queued','scout',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            id, key, normalized.platform, normalized.action, normalized.method, normalized.accountScope, normalized.targetUrl,
            normalized.topic, normalized.brief,
            JSON.stringify({ sources: normalized.provenance, evidence: normalized.evidence, observedAt: normalized.observedAt, injectionFlag: normalized.injectionFlag }),
            normalized.relevance, config.publish.defaultMode, now, now, normalized.expiresAt, null,
          );
          accepted.push(publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)));
        } catch (error) {
          if (error instanceof LaneError && error.code === "brief-quota") throw error;
          rejected.push({ error: error.code || "invalid", message: error.message });
        }
      }
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    return { accepted, rejected };
  } finally { db.close(); }
}

export function claimCore({ dbPath, config, workerId, accounts, now = Date.now() }) {
  assertEnabled(config);
  const allowed = accountFilter(accounts);
  if (!allowed) throw new LaneError("no-account-scope", "worker grant has no approved account");
  const db = openDb(dbPath);
  try {
    maintenanceCore(db, config, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      const placeholders = allowed.map(() => "?").join(",");
      const row = db.prepare(`SELECT * FROM jobs WHERE state='queued' AND expires_at > ? AND account_scope IN (${placeholders})
        ORDER BY relevance DESC, created_at ASC LIMIT 1`).get(now, ...allowed);
      if (!row) { db.exec("COMMIT"); return { claimed: false, reason: "no eligible job" }; }
      if (!reserveQuota(db, now, `claims:${workerId}`, config.limits.maxClaimsPerDay)) {
        db.exec("ROLLBACK"); return { claimed: false, throttled: true, reason: "daily claim limit" };
      }
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

export function preflightCore(job, config, now = Date.now(), { forSubmit = false, requireLease = true } = {}) {
  const checks = {
    optIn: config.mode !== "off" && config.operatorOptIn,
    notExpired: job.expiresAt > now,
    leaseLive: requireLease ? (job.state === "claimed" && job.leaseUntil > now) : true,
    xOnly: job.platform === "x",
    allowedAction: ACTIONS.has(job.action) && !DISALLOWED.test(`${job.action} ${job.topic}`),
    approvedAccount: config.accounts.includes(job.accountScope),
    approvedMethod: config.publish.allowedMethods.includes(job.method ?? "manual"),
    publishAllowed: job.publishMode !== "preauthorized" || config.publish.preauthorized === true,
    injectionSafe: !job.untrustedFlags?.injection || !forSubmit,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function owned(db, { jobId, workerId, fencingToken, revision, now, states }) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job) return { job: null, code: "not-found" };
  if (!states.includes(job.state)) return { job, code: "wrong-state" };
  const fenced = job.worker_id === workerId && job.fencing_token === Number(fencingToken) && job.revision === Number(revision);
  const live = job.state === "claimed" ? job.lease_until >= now : job.state === "submitting" ? job.submit_deadline >= now && job.lease_until >= now : true;
  return fenced && live ? { job } : { job, code: "stale" };
}

export function beginSubmitCore({ dbPath, config, jobId, workerId, fencingToken, revision, now = Date.now() }) {
  assertLive(config);
  const db = openDb(dbPath);
  try {
    maintenanceCore(db, config, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      const found = owned(db, { jobId, workerId, fencingToken, revision, now, states: ["claimed"] });
      if (found.code) { db.exec("ROLLBACK"); return { ok: false, code: found.code }; }
      const job = publicJob(found.job);
      if (job.publishMode !== "preauthorized") { db.exec("ROLLBACK"); throw new LaneError("draft-only", "draft-only jobs cannot begin an external submit"); }
      const gate = preflightCore(job, config, now, { forSubmit: true });
      if (!gate.ok) { db.exec("ROLLBACK"); return { ok: false, code: "preflight", checks: gate.checks }; }
      const quotaScope = `publish:${job.accountScope}`;
      if (!reserveQuota(db, now, quotaScope, config.limits.maxPerAccountPerDay)) {
        db.exec("ROLLBACK"); return { ok: false, code: "limit", reason: "per-account daily publish limit" };
      }
      const token = randomUUID();
      const deadline = now + config.limits.submitTimeoutMinutes * 60_000;
      db.prepare(`UPDATE jobs SET state='submitting', submit_token=?, submit_started_at=?, submit_deadline=?,
        lease_until=?, quota_reserved=1, quota_day=?, quota_scope=?, revision=revision+1, updated_at=? WHERE id=?`).run(
        token, now, deadline, deadline, dayStart(now), quotaScope, now, jobId,
      );
      db.exec("COMMIT");
      return { ok: true, submitToken: token, revision: found.job.revision + 1, submitDeadline: deadline };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function reportCore({ dbPath, config, jobId, workerId, fencingToken, revision, status, submitToken, receipt, content, reason, now = Date.now() }) {
  assertEnabled(config);
  if (!REPORT_STATUSES.has(status)) throw new LaneError("invalid-status", "unsupported report status");
  const db = openDb(dbPath);
  try {
    maintenanceCore(db, config, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      const states = status === "published" || status === "uncertain" ? ["submitting"] : ["claimed"];
      const found = owned(db, { jobId, workerId, fencingToken, revision, now, states });
      if (found.code) { db.exec("ROLLBACK"); return { ok: false, code: found.code, state: found.job?.state }; }
      const job = publicJob(found.job);
      if (config.mode !== "live" && status === "published") { db.exec("ROLLBACK"); throw new LaneError("live-only", "publication is unavailable outside live mode"); }
      if (status === "published") {
        if (job.publishMode !== "preauthorized" || !config.publish.preauthorized) { db.exec("ROLLBACK"); throw new LaneError("publish-not-authorized", "job or operator policy is draft-only"); }
        if (!sameSecret(submitToken, found.job.submit_token)) { db.exec("ROLLBACK"); return { ok: false, code: "submit-token" }; }
        if (!receipt || !receipt.url) { db.exec("ROLLBACK"); throw new LaneError("missing-receipt", "published requires a public receipt URL"); }
        receipt = { url: canonicalPublicUrl(receipt.url), externalId: receipt.externalId ? String(receipt.externalId).slice(0, 120) : null, observedAt: receipt.observedAt || null };
        const gate = preflightCore(job, config, now, { forSubmit: true, requireLease: false });
        if (!gate.ok) { db.exec("ROLLBACK"); return { ok: false, code: "preflight", checks: gate.checks }; }
        if (!found.job.quota_reserved) {
          db.exec("ROLLBACK"); return { ok: false, code: "quota-unreserved", reason: "publish quota must be reserved before submit" };
        }
      }
      if (status === "uncertain" && !sameSecret(submitToken, found.job.submit_token)) { db.exec("ROLLBACK"); return { ok: false, code: "submit-token" }; }
      if (status === "drafted") {
        const gate = preflightCore(job, config, now);
        if (!gate.ok) { db.exec("ROLLBACK"); return { ok: false, code: "preflight", checks: gate.checks }; }
        content = cleanText(content, "content", 20, MAX_TEXT);
      }
      if (["failed", "skipped", "uncertain"].includes(status)) reason = cleanText(reason ?? "", "reason", 3, 300);
      const next = status === "published" ? "published" : status === "drafted" ? "draft" : status;
      db.prepare(`UPDATE jobs SET state=?, revision=revision+1, lease_until=NULL, result_url=?, result_status=?, reason=?,
        content=COALESCE(?,content), receipt_json=?, submit_token=NULL, updated_at=? WHERE id=?`).run(
        next, receipt?.url ?? null, receipt?.url ? "published" : null, reason ?? null, content ?? null,
        receipt ? JSON.stringify(receipt) : null, now, jobId,
      );
      if (["published", "failed", "skipped"].includes(status)) {
        db.prepare(`INSERT INTO cooldowns (dedupe_key,until,reason) VALUES (?,?,?)
          ON CONFLICT(dedupe_key) DO UPDATE SET until=excluded.until, reason=excluded.reason`).run(
          found.job.dedupe_key, now + config.limits.failureCooldownMinutes * 60_000, status,
        );
      }
      db.exec("COMMIT");
      return { ok: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)) };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function resolveUncertainCore({ dbPath, config, jobId, resolution, receipt, reason, now = Date.now() }) {
  assertEnabled(config);
  if (!["verified", "retry", "reject"].includes(resolution)) throw new LaneError("invalid-resolution", "resolution must be verified, retry or reject");
  if (resolution === "verified") assertLive(config);
  const db = openDb(dbPath);
  try {
    maintenanceCore(db, config, now);
    db.exec("BEGIN IMMEDIATE");
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (!job || job.state !== "uncertain") { db.exec("ROLLBACK"); return { ok: false, code: "not-uncertain" }; }
      if (resolution === "retry") {
        db.prepare("UPDATE jobs SET state='queued', revision=revision+1, worker_id=NULL, lease_until=NULL, submit_token=NULL, quota_reserved=0, quota_day=NULL, quota_scope=NULL, updated_at=? WHERE id=?").run(now, jobId);
      } else {
        if (resolution === "verified" && (!receipt || !receipt.url)) { db.exec("ROLLBACK"); throw new LaneError("missing-receipt", "verified requires a public receipt URL"); }
        const rec = resolution === "verified" ? { url: canonicalPublicUrl(receipt.url), externalId: receipt.externalId ? String(receipt.externalId).slice(0, 120) : null, observedAt: receipt.observedAt || null } : null;
        db.prepare("UPDATE jobs SET state=?, revision=revision+1, receipt_json=?, result_url=?, reason=?, updated_at=? WHERE id=?").run(
          resolution === "verified" ? "published" : "skipped", rec ? JSON.stringify(rec) : null, rec?.url ?? null,
          cleanText(reason ?? resolution, "reason", 3, 300), now, jobId,
        );
        db.prepare(`INSERT INTO cooldowns (dedupe_key,until,reason) VALUES (?,?,?)
          ON CONFLICT(dedupe_key) DO UPDATE SET until=excluded.until, reason=excluded.reason`).run(job.dedupe_key, now + config.limits.failureCooldownMinutes * 60_000, `uncertain-${resolution}`);
      }
      db.exec("COMMIT");
      return { ok: true, job: publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)) };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

export function listJobs({ dbPath, config, state, workerId, accounts, operator = false, limit = 20, now = Date.now() }) {
  const db = openDb(dbPath);
  try {
    if (config) maintenanceCore(db, config, now);
    const allowed = accountFilter(accounts);
    const conditions = [];
    const params = [];
    if (state) { conditions.push("state = ?"); params.push(state); }
    if (!operator) {
      if (!workerId || !allowed) return [];
      conditions.push("(worker_id = ? OR state='queued')");
      params.push(workerId);
    }
    if (allowed) {
      conditions.push(`account_scope IN (${allowed.map(() => "?").join(",")})`);
      params.push(...allowed);
    } else {
      return [];
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return db.prepare(`SELECT * FROM jobs ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params, Math.min(100, limit)).map(publicJob);
  } finally { db.close(); }
}

export function getJob({ dbPath, config, jobId, now = Date.now() }) {
  const db = openDb(dbPath);
  try {
    if (config) maintenanceCore(db, config, now);
    return publicJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId));
  } finally { db.close(); }
}

export function expireJobs({ dbPath, config, now = Date.now() }) {
  const db = openDb(dbPath);
  try { maintenanceCore(db, config, now); return { ok: true }; } finally { db.close(); }
}

export function publicJob(row) {
  if (!row) return null;
  const provenance = JSON.parse(row.provenance_json || "{}");
  return {
    id: row.id, state: row.state, source: row.source, platform: row.platform, action: row.action,
    method: row.method, accountScope: row.account_scope, workerId: row.worker_id, targetUrl: row.target_url, topic: row.topic,
    brief: row.brief, provenance, relevance: row.relevance, publishMode: row.publish_mode,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    leaseUntil: row.lease_until, fencingToken: row.fencing_token, revision: row.revision,
    attempts: row.attempts, resultUrl: row.result_url, resultStatus: row.result_status,
    reason: row.reason, content: row.content,
    receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null,
    untrustedFlags: { injection: provenance.injectionFlag === true },
  };
}
