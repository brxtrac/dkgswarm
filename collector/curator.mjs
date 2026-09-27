#!/usr/bin/env node
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const graph = "trac-marketing";
const db = new DatabaseSync(process.env.WATCH_DB || "/root/dkg-swarm-webhooks/data/watcher.sqlite", { readOnly: true });
const api = (process.env.DKG_API_URL || "http://127.0.0.1:9200").replace(/\/$/, "");
const token = process.argv[1]?.endsWith("curator.mjs") ? (fs.readFileSync(process.env.DKG_API_TOKEN_FILE || "/root/.dkg/auth.token", "utf8")
  .split(/\n/).find((line) => line.trim() && !line.startsWith("#")) || "").trim() : "";
const lit = (s) => JSON.stringify(String(s ?? ""));
const quad = (subject, predicate, object) => ({ subject, predicate, object });
const term = (value) => {
  const raw = value?.value ?? value;
  if (typeof raw !== "string" || !raw.startsWith('"')) return raw;
  try { return JSON.parse(raw); } catch { return raw; }
};
export const askTrue = (response) => response?.result?.value === true || response?.result?.value === "true" || response?.result?.boolean === true || response?.boolean === true;
const ns = "https://www.dkgswarm.com/ontology/curator/";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const intakePath = process.env.TRAC_CURATOR_INTAKE || "/root/dkg-swarm-webhooks/data/curator-intake.sqlite";
const reviewPath = process.env.TRAC_CURATOR_REVIEW || "/root/dkg-swarm-webhooks/data/curator-review.sqlite";

function reviewStore() {
  const store = new DatabaseSync(reviewPath);
  store.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS decisions (kind TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL,
      reason TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id));`);
  return store;
}

function decision(kind, id, status, reason = "") {
  const store = reviewStore();
  try { store.prepare(`INSERT INTO decisions VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind,id) DO UPDATE SET status=excluded.status, reason=excluded.reason, updated_at=excluded.updated_at`)
    .run(kind, id, status, reason.slice(0, 300), new Date().toISOString()); }
  finally { store.close(); }
}

function reviewed(kind) {
  const store = reviewStore();
  try { return new Set(store.prepare("SELECT id FROM decisions WHERE kind = ? AND status IN ('promoted','rejected','duplicate')").all(kind).map((r) => r.id)); }
  finally { store.close(); }
}

function intake() {
  if (!fs.existsSync(intakePath)) return [];
  const store = new DatabaseSync(intakePath);
  try { return store.prepare("SELECT name, queued_at FROM drafts WHERE reviewed_at IS NULL ORDER BY queued_at LIMIT 10").all(); }
  finally { store.close(); }
}

export function canonicalUrl(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("unsupported URL");
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|s$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const post = url.pathname.match(/^\/(?:i\/)?(?:[^/]+\/)?status\/(\d+)$/);
  if (["x.com", "twitter.com", "mobile.twitter.com"].includes(url.hostname) && post) return `https://x.com/i/status/${post[1]}`;
  return url.toString();
}

export function validateCollectivePush({ name, url, postId, issuedAt, expiresAt, publisher, angle, text }, at = Date.now()) {
  if (!/^collective[-_]?push[-_]/i.test(name || "")) throw new Error("not a collective push");
  if (!/^\d{8,22}$/.test(postId || "") || canonicalUrl(url) !== `https://x.com/i/status/${postId}`) throw new Error("invalid push target URL or post ID");
  if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Math.max(at, Date.parse(issuedAt))) throw new Error("collective push expired or has invalid dates");
  if (Date.parse(issuedAt) > at + 5 * 60_000) throw new Error("collective push issue time is in future");
  if (!String(publisher || "").trim() || !String(angle || "").trim() || String(text || "").trim().length < 40) throw new Error("collective push lacks publisher, angle or context");
  return `https://x.com/i/status/${postId}`;
}


async function request(route, body, method = "POST") {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`DKG ${response.status}: ${String(result.error || result.message || "request failed").slice(0, 250)}`);
  return result;
}

function candidates() {
  return db.prepare(`SELECT o.post_id, o.account, o.post_url, o.summary, o.created_at, o.observed_at,
      o.classification_json, r.status AS raw_status, i.status AS insight_status
    FROM observations o
    JOIN deliveries r ON r.post_id = o.post_id AND r.stage = 'raw-dkg'
    JOIN deliveries i ON i.post_id = o.post_id AND i.stage = 'derived-dkg'
    WHERE r.status = 'completed' AND i.status = 'completed'
    ORDER BY o.observed_at DESC`).all();
}

// Duplicate inventory is evidence for review, but SPARQL term metadata and
// repeated URL objects add no decision value to the agent's context.
function duplicateEvidence(matches) {
  return matches.map((row) => ({
    view: row.view,
    subject: row.s?.value || row.s,
    predicate: row.p?.value || row.p,
  }));
}

async function duplicateInventory(url) {
  const normalized = canonicalUrl(url);
  const matches = [];
  // Page across every URL-like predicate, not a truncated first slice.
  for (const view of ["shared-working-memory", "working-memory"]) {
    for (let offset = 0; ; offset += 500) {
      const result = await request("/api/query", { contextGraphId: graph, view,
        sparql: `SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(?p IN (<https://schema.org/url>, <https://schema.org/sameAs>, <${ns}canonicalUrl>, <http://www.w3.org/2002/07/owl#sameAs>)) } ORDER BY ?s ?p ?o LIMIT 500 OFFSET ${offset}` });
      const bindings = result?.result?.bindings || result?.bindings;
      if (!Array.isArray(bindings)) throw new Error(`${view} inventory unavailable; no promotion allowed`);
      for (const row of bindings) {
        const value = row.o?.value || row.o;
        try { if (canonicalUrl(value) === normalized) matches.push({ ...row, view }); } catch {}
      }
      if (bindings.length < 500) break;
      if (offset >= 50000) throw new Error("duplicate inventory exceeds safe pagination; no promotion allowed");
    }
  }
  return matches;
}

async function main() {
  const [action, id] = process.argv.slice(2);
  if (action === "list") {
    const seen = reviewed("x");
    const rows = candidates().filter((row) => !seen.has(row.post_id)).slice(0, 20).map((row) => ({
      id: row.post_id, account: row.account, url: row.post_url,
      summary: row.summary.slice(0, 250), observedAt: row.observed_at,
      category: JSON.parse(row.classification_json || "{}").category,
      sourceTier: JSON.parse(row.classification_json || "{}").sourceTier,
    }));
    const communitySeen = reviewed("community");
    console.log(JSON.stringify({ graph, count: rows.length, candidates: rows, communityDrafts: intake().filter((row) => !communitySeen.has(row.name)).slice(0, 10) }));
    return;
  }
  if (action === "reject") {
    const [kind, name, ...reason] = process.argv.slice(3);
    if (!["x", "community"].includes(kind) || !/^[a-zA-Z0-9._-]{1,80}$/.test(name || "") || !reason.join(" ").trim()) throw new Error("Usage: reject x|community <id> <reason>");
    decision(kind, name, "rejected", reason.join(" "));
    console.log(JSON.stringify({ rejected: name, reason: reason.join(" ") }));
    return;
  }
  if (action === "community" || action === "promote-community") {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id || "")) throw new Error("invalid draft name");
    const queued = intake().find((item) => item.name === id);
    if (!queued) throw new Error("draft not in authenticated MCP review queue");
    const result = await request("/api/query", { contextGraphId: graph, view: "working-memory",
      sparql: `SELECT ?p ?o WHERE { <https://www.dkgswarm.com/ka/${id}> ?p ?o } LIMIT 100` });
    const bindings = result?.result?.bindings || result?.bindings;
    if (!Array.isArray(bindings) || bindings.length >= 100) throw new Error("incomplete WM draft read");
    const source = bindings.find((item) => (item.p?.value || item.p) === "https://schema.org/url");
    const url = source?.o?.value || source?.o;
    const duplicates = url ? await duplicateInventory(url) : [];
    console.log(JSON.stringify({ name: id, quads: bindings.map((row) => ({ predicate: row.p?.value || row.p, object: term(row.o) })), canonicalUrl: url ? canonicalUrl(url) : null, duplicates: duplicateEvidence(duplicates) }));
    if (action === "community") return;
    const publisher = bindings.find((item) => (item.p?.value || item.p) === "https://schema.org/publisher");
    const comment = bindings.find((item) => (item.p?.value || item.p) === "http://www.w3.org/2000/01/rdf-schema#comment");
    const field = (predicate) => { const row = bindings.find((item) => (item.p?.value || item.p) === predicate); return term(row?.o); };
    const postId = field("https://schema.org/identifier");
    const issuedAt = field("https://schema.org/dateCreated");
    const expiresAt = field("https://schema.org/expires");
    const angle = field(`${ns}proposedAngle`);
    const text = term(comment?.o) || "";
    const isPush = /^collective[-_]?push[-_]/i.test(id);
    if (!isPush && (!url || !publisher || typeof text !== "string" || text.length < 40 || duplicates.length)) throw new Error("community source, publisher, substantive text and unique URL required");
    const canonical = isPush ? validateCollectivePush({ name: id, url, postId, issuedAt, expiresAt, publisher: term(publisher?.o), angle, text }) : canonicalUrl(url);
    if (!isPush && !/^https:\/\/x\.com\/i\/status\/\d+$/.test(canonical)) throw new Error("community post requires X post URL");
    const name = `${isPush ? "curator-push-" : "curator-"}${id.toLowerCase()}`.slice(0, 80);
    const subject = `https://www.dkgswarm.com/ka/${name}`;
    const current = await duplicateInventory(canonical);
    if (!isPush && current.some((item) => item.view === "shared-working-memory")) throw new Error("duplicate appeared during review");
    if (!isPush && current.some((item) => item.view === "working-memory" && ![subject, `https://www.dkgswarm.com/ka/${id}`].includes(item.s?.value || item.s))) throw new Error("competing WM draft; review before promotion");
    const sharedPush = async () => askTrue(await request("/api/query", { contextGraphId: graph, view: "shared-working-memory", sparql: `ASK { <${subject}> <${ns}targetPost> <${canonical}> }` }));
    const alreadyShared = isPush && await sharedPush();
    if (alreadyShared) {
      decision("community", id, "promoted", "already shared");
      const store = new DatabaseSync(intakePath);
      try { store.prepare("UPDATE drafts SET reviewed_at = ? WHERE name = ? AND queued_at = ?").run(new Date().toISOString(), id, queued.queued_at); }
      finally { store.close(); }
      console.log(JSON.stringify({ promoted: name, recovered: true }));
      return;
    }
    if (!current.some((item) => (item.s?.value || item.s) === subject)) await request("/api/knowledge-assets", { contextGraphId: graph, name, finalize: false, alsoShareSwm: false, quads: [
      quad(subject, rdfType, `${ns}${isPush ? "CollectivePush" : "CommunityEvidence"}`),
      ...(isPush ? [quad(subject, `${ns}targetPost`, canonical)] : [quad(subject, "https://schema.org/url", canonical), quad(subject, `${ns}canonicalUrl`, canonical)]),
      quad(subject, `${ns}publisher`, lit(term(publisher.o))),
      quad(subject, "http://www.w3.org/2000/01/rdf-schema#comment", lit(text)),
      quad(subject, `${ns}sourceTier`, lit(isPush ? "authenticated-writer-directive" : "community-unverified")),
      quad(subject, `${ns}observedAt`, lit(new Date().toISOString())),
      quad(subject, `${ns}claimStatus`, lit(isPush ? "coordination request; claims require independent verification" : "community-submitted; not independently verified")),
      quad(subject, "https://schema.org/identifier", lit(postId)),
      quad(subject, "https://schema.org/dateCreated", lit(issuedAt)),
      quad(subject, "https://schema.org/expires", lit(expiresAt)),
      quad(subject, `${ns}proposedAngle`, lit(angle)),
      quad(subject, `${ns}derivedFrom`, `https://www.dkgswarm.com/ka/${id}`),
    ] });
    let shared;
    try { shared = await request(`/api/knowledge-assets/${name}/swm/share`, { contextGraphId: graph }); }
    catch (error) {
      if (!isPush) throw error;
      if (!await sharedPush()) throw error;
      shared = { recovered: true };
    }
    const confirmation = isPush ? await sharedPush() : await duplicateInventory(canonical);
    if (isPush ? !confirmation : !confirmation.some((item) => item.view === "shared-working-memory" && (item.s?.value || item.s) === subject)) throw new Error("SWM share not queryable; review remains queued");
    decision("community", id, "promoted");
    const store = new DatabaseSync(intakePath);
    try { store.prepare("UPDATE drafts SET reviewed_at = ? WHERE name = ? AND queued_at = ?").run(new Date().toISOString(), id, queued.queued_at); }
    finally { store.close(); }
    console.log(JSON.stringify({ promoted: name, shared }));
    return;
  }
  if (action !== "review" && action !== "promote") throw new Error("Usage: node curator.mjs list|review <post-id>|promote <post-id>");
  if (!/^\d{8,22}$/.test(id || "")) throw new Error("invalid X post ID");
  const row = db.prepare(`SELECT o.*, r.status AS raw_status, i.status AS insight_status
    FROM observations o JOIN deliveries r ON r.post_id = o.post_id AND r.stage = 'raw-dkg'
    JOIN deliveries i ON i.post_id = o.post_id AND i.stage = 'derived-dkg' WHERE o.post_id = ?`).get(id);
  if (!row || row.raw_status !== "completed" || row.insight_status !== "completed") throw new Error("both WM drafts must be complete");
  if (canonicalUrl(row.post_url) !== `https://x.com/i/status/${id}`) throw new Error("source URL does not match post ID");
  const url = canonicalUrl(row.post_url);
  const duplicates = await duplicateInventory(url);
  console.log(JSON.stringify({ id, canonicalUrl: url, account: row.account, summary: row.summary,
    observedAt: row.observed_at, classification: JSON.parse(row.classification_json), duplicates: duplicateEvidence(duplicates) }));
  if (action === "review") return;
  const existingSwm = duplicates.filter((item) => item.view === "shared-working-memory");
  if (existingSwm.length) { decision("x", id, "duplicate", "source URL already in SWM"); throw new Error("duplicate source URL in SWM; promotion blocked"); }
  if (row.summary.length < 40 || !row.account || !row.created_at) throw new Error("insufficient source evidence");
  const name = `curator-x-post-${id}`;
  const subject = `https://www.dkgswarm.com/ka/${name}`;
  const sourceTier = JSON.parse(row.classification_json).sourceTier || "discovery";
  const quads = [
    quad(subject, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", "https://schema.org/SocialMediaPosting"),
    quad(subject, "https://schema.org/url", url),
    quad(subject, `${ns}canonicalUrl`, url),
    quad(subject, "https://schema.org/author", `https://x.com/${row.account.replace(/^@/, "")}`),
    quad(subject, "https://schema.org/articleBody", lit(row.summary)),
    quad(subject, `${ns}publisher`, lit(row.account)),
    quad(subject, `${ns}observedAt`, lit(row.observed_at)),
    quad(subject, `${ns}sourceTier`, lit(sourceTier)),
    quad(subject, `${ns}claimStatus`, lit("source self-report; not independently verified")),
    quad(subject, `${ns}sourcePost`, `https://x.com/i/status/${id}`),
  ];
  // Check again immediately before mutation. Concurrent curators must use run lock.
  const current = await duplicateInventory(url);
  if (current.some((item) => item.view === "shared-working-memory")) throw new Error("duplicate appeared during review");
  if (current.some((item) => item.view === "working-memory" && ![subject, `https://x.com/i/status/${id}`].includes(item.s?.value || item.s))) throw new Error("competing WM draft; review before promotion");
  if (!current.some((item) => (item.s?.value || item.s) === subject)) await request("/api/knowledge-assets", { contextGraphId: graph, name, quads, finalize: false, alsoShareSwm: false });
  const shared = await request(`/api/knowledge-assets/${name}/swm/share`, { contextGraphId: graph });
  if (!(await duplicateInventory(url)).some((item) => item.view === "shared-working-memory" && (item.s?.value || item.s) === subject)) throw new Error("SWM share not queryable");
  decision("x", id, "promoted");
  console.log(JSON.stringify({ promoted: name, shared }));
}

if (process.argv[1]?.endsWith("curator.mjs")) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
