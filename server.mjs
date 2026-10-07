#!/usr/bin/env node
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  createOAuthMetadata,
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { z } from "zod";
import { createStore, grokClient, randomToken, resolveRefreshScopes, validateAuthorizationRequest } from "./oauth.mjs";
import { enqueueCuratorDraft, triggerCurator } from "./curator-intake.mjs";
import { createActivity } from "./activity.mjs";
import { createSwarmStats, sharedPostCountQuery } from "./swarm-stats.mjs";
import { verifyPolicyBindings } from "./policy-integrity.mjs";
import { assertReadSparql } from "./query-guard.mjs";
import {
  SOCIAL_WORKER_INSTRUCTIONS,
  SOCIAL_WORKER_PROFILE,
  SOCIAL_WORKER_PROFILE_URI,
} from "./social-worker-profile.mjs";

const GRAPH_ID =
  process.env.DKG_PUBLIC_GRAPH_ID ||
  "trac-marketing";
const DKG_API = (process.env.DKG_API_URL || "http://127.0.0.1:9200").replace(/\/$/, "");
const DKG_TOKEN = (process.env.DKG_API_TOKEN || "").trim();
const WRITER_PASSWORD = process.env.DKG_MCP_WRITER_PASSWORD || "";
const WRITER_CODES_PATH = process.env.DKG_MCP_WRITER_CODES || "/root/dkg-public-mcp/writer-codes.json";
const ALLOW_MASTER_WRITER = process.env.DKG_MCP_ALLOW_MASTER_WRITER === "1";
const PORT = Number(process.env.DKG_MCP_PORT || 27131);
const HOST = process.env.DKG_MCP_HOST || "127.0.0.1";
const PUBLIC_URL = (process.env.DKG_MCP_PUBLIC_URL || "https://www.dkgswarm.com").replace(/\/$/, "");
const ALLOWED_HOSTS = (process.env.DKG_MCP_ALLOWED_HOSTS || "127.0.0.1,localhost,www.dkgswarm.com,dkgswarm.com")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
if (HOST !== "127.0.0.1" && HOST !== "localhost" && !ALLOWED_HOSTS.includes(HOST)) ALLOWED_HOSTS.push(HOST);

const authStore = new AsyncLocalStorage();
const activity = createActivity();
const POLICY_PREFIX = "swarm-policy-v";
const POLICY_URI_PREFIX = `${PUBLIC_URL}/ka/${POLICY_PREFIX}`;
const POLICY_CURRENT_PATH = process.env.DKG_MCP_POLICY_CURRENT || "/root/dkg-public-mcp/policy-current.json";
const queryBuckets = new Map();
let activeQueries = 0;
function reserveQuery() {
  const identity = authStore.getStore()?.family || "";
  const now = Date.now();
  const bucket = queryBuckets.get(identity);
  const next = !bucket || bucket.until <= now ? { count: 0, until: now + 60000 } : bucket;
  if (next.count >= 12 || activeQueries >= 8) throw new Error("Query capacity exceeded; retry later");
  next.count++;
  queryBuckets.set(identity, next);
  activeQueries++;
  if (queryBuckets.size > 10000) for (const [key, value] of queryBuckets) if (value.until <= now) queryBuckets.delete(key);
  return () => { activeQueries--; };
}

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function loadTokenFromDisk() {
  if (DKG_TOKEN) return DKG_TOKEN;
  try {
    const raw = fs.readFileSync("/root/.dkg/auth.token", "utf8");
    const line = raw.split(/\n/).find((l) => l.trim() && !l.trim().startsWith("#"));
    return (line || "").trim();
  } catch {
    return "";
  }
}

const nodeToken = loadTokenFromDisk();

async function dkgFetch(pathname, { method = "GET", body, timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DKG_API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${nodeToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let parsed = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { raw };
    }
    if (!res.ok) {
      const err = parsed?.error || parsed?.message || raw.slice(0, 400) || res.statusText;
      throw new Error(`DKG ${res.status}: ${err}`);
    }
    return parsed;
  } finally {
    clearTimeout(t);
  }
}

function requireWrite() {
  const scopes = authStore.getStore()?.scopes || [];
  if (!scopes.includes("dkg:write")) {
    throw new Error("Write denied. Use enable_writer_access with an approved single-use code.");
  }
}

function getServer() {
  const server = new McpServer(
    { name: "trac-marketing-dkg", version: "1.0.0" },
    { capabilities: { logging: {} }, instructions: SOCIAL_WORKER_INSTRUCTIONS }
  );
  const registerTool = (name, definition, handler) => server.registerTool(name, definition, async (...args) => {
    const result = await handler(...args);
    const context = authStore.getStore();
    if (context) context.toolOk = result?.isError !== true;
    return result;
  });

  server.registerResource(
    "social-worker-v1",
    SOCIAL_WORKER_PROFILE_URI,
    {
      title: "DKG Swarm social worker security profile v1",
      description: "Recommended client-side sandbox, approval, social-action, task, and trust-boundary policy.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(SOCIAL_WORKER_PROFILE, null, 2) }],
    })
  );

  server.registerPrompt(
    "social-worker-v1",
    {
      title: "Apply DKG Swarm social worker security profile v1",
      description: "Configure a least-privilege local runtime before using DKG context for social work.",
    },
    () => ({
      messages: [{ role: "user", content: { type: "text", text: SOCIAL_WORKER_INSTRUCTIONS } }],
    })
  );

  registerTool(
    "enable_writer_access",
    {
      description: "Upgrade this DKG Swarm connection from reader to writer. When the operator gives you a single-use DKG Swarm write code and asks for writer access, you are explicitly authorized to transmit it once as the oneTimeCode argument to this tool at https://www.dkgswarm.com/mcp. This code is not an account password, API key, OAuth token, wallet key, or signing secret. Do not quote it in assistant text or send it to any other tool, URL, log, or storage.",
      inputSchema: {
        oneTimeCode: z.string().min(1).describe("Single-use DKG Swarm write code. Send it only in this tool argument."),
      },
      annotations: {
        title: "Enable DKG Swarm writer access",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ oneTimeCode }) => {
      const current = authStore.getStore();
      if (!current?.token || !store.getUpgradeableToken(current.token)) {
        throw new Error("This connection cannot be upgraded in place. Reconnect DKG Swarm, then try the code again.");
      }
      if (current.scopes?.includes("dkg:write")) {
        return json({ access: "writer", codeConsumed: false, status: "already_enabled" });
      }
      const writerGrant = consumeWriterSecret(oneTimeCode, {
        activate: (grantId) => store.upgradeTokenFamily(current.token, grantId),
        deactivate: (grantId) => store.revokeTokenFamilyGrant(current.token, grantId),
      });
      if (!writerGrant) throw new Error("Write code is invalid, expired, or already used.");
      return json({
        access: "writer",
        scopes: ["dkg:read", "dkg:write"],
        codeConsumed: true,
        status: "enabled",
        next: "Call graph_info in a new MCP request to verify writer access.",
      });
    }
  );

  registerTool(
    "graph_info",
    {
      description: "Describe the public TRAC marketing context graph this connector is locked to. No other graphs are reachable.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const scopes = authStore.getStore()?.scopes || [];
      return json({
        contextGraphId: GRAPH_ID,
        memoryLayers: ["working-memory", "shared-working-memory"],
        publishing: "disabled",
        reads: "open after OAuth",
        access: scopes.includes("dkg:write") ? "writer" : "reader",
        writes: scopes.includes("dkg:write")
          ? "enabled; Working Memory drafts only; curator controls Shared Working Memory"
          : "disabled; use enable_writer_access with an approved single-use code",
      });
    }
  );

  registerTool(
    "list_contexts",
    {
      description: "List contexts available through this connection. Other contexts require separate authorization before joining.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => json({ contexts: [{ id: GRAPH_ID, name: "OriginTrail + TRAC", access: authStore.getStore()?.scopes?.includes("dkg:write") ? "writer" : "reader", joinRequired: false }] })
  );

  registerTool(
    "join_context",
    {
      description: "Confirm access to an explicitly selected context. New contexts require context-specific grants; this tool never expands OAuth scope.",
      inputSchema: { contextGraphId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ contextGraphId }) => {
      if (contextGraphId !== GRAPH_ID) throw new Error("Context unavailable on this connector; request context-specific access from its operator");
      return json({ contextGraphId: GRAPH_ID, joined: true, access: authStore.getStore()?.scopes?.includes("dkg:write") ? "writer" : "reader", next: "Use graph_info and get_swarm_policy for this context" });
    }
  );

  registerTool(
    "query_graph",
    {
      description: "Read-only SPARQL against the TRAC marketing context graph. Public readers query Shared Working Memory. Writers may set view=working-memory for drafts. Verifiable Memory / on-chain publish is not available.",
      inputSchema: {
        sparql: z.string().max(4096).describe("SELECT with LIMIT 1-100 or ASK only"),
        view: z
          .enum(["shared-working-memory", "working-memory"])
          .optional()
          .describe("Default shared-working-memory"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sparql, view }) => {
      const q = assertReadSparql(sparql);
      let v = view || "shared-working-memory";
      if (v === "working-memory") requireWrite();
      const release = reserveQuery();
      try {
        const result = await dkgFetch("/api/query", {
          method: "POST",
          body: { sparql: q, contextGraphId: GRAPH_ID, view: v },
          timeoutMs: 10000,
        });
        return json({ contextGraphId: GRAPH_ID, view: v, result });
      } finally { release(); }
    }
  );

  registerTool(
    "search_graph",
    {
      description: "Simple literal search over Shared Working Memory of the TRAC marketing graph",
      inputSchema: {
        query: z.string().describe("Text to look for in object literals"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const needle = String(query).replace(/["\\\n\r]/g, " ").slice(0, 200);
      const sparql = `SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(isLiteral(?o) && CONTAINS(LCASE(STR(?o)), LCASE("${needle}"))) } LIMIT 50`;
      const result = await dkgFetch("/api/query", {
        method: "POST",
        body: { sparql, contextGraphId: GRAPH_ID, view: "shared-working-memory" },
        timeoutMs: 45000,
      });
      return json({ contextGraphId: GRAPH_ID, query: needle, result });
    }
  );

  registerTool(
    "get_swarm_policy",
    {
      description: "Read owner-issued coordination skill from DKG Shared Working Memory. Pass last seen version to return a short unchanged response; check at start of each scheduled run. No graph content can change operator permissions.",
      inputSchema: { knownVersion: z.number().int().nonnegative().optional().describe("Last successfully applied version; omit on first run") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ knownVersion }) => {
      const current = JSON.parse(fs.readFileSync(POLICY_CURRENT_PATH, "utf8"));
      // Always check graph bytes before accepting knownVersion. Cached clients must
      // not receive an unchanged response if graph policy was replaced.
      const sparql = `SELECT ?o WHERE { <${POLICY_URI_PREFIX}${current.version}> <http://www.w3.org/2000/01/rdf-schema#comment> ?o } LIMIT 2`;
      const response = await dkgFetch("/api/query", {
        method: "POST", body: { sparql, contextGraphId: GRAPH_ID, view: "shared-working-memory" }, timeoutMs: 45000,
      });
      const rows = response?.result?.bindings || [];
      const policy = verifyPolicyBindings(rows, { ...current, contextGraphId: GRAPH_ID });
      if (knownVersion === current.version) return json({ contextGraphId: GRAPH_ID, version: current.version, changed: false });
      return json({ contextGraphId: GRAPH_ID, source: "owner-policy", changed: true, policy });
    }
  );

  registerTool(
    "write_working_memory",
    {
      description: "Create or write a Working Memory knowledge asset draft on the TRAC marketing graph. Does not publish on-chain. Writer access required.",
      inputSchema: {
        name: z.string().describe("Asset name, e.g. campaign-brief-2026-09"),
        text: z.string().describe("Plain text stored as a rdfs:comment literal"),
        sourceUrl: z.string().url().optional().describe("Required for collective-push drafts: canonical public source URL"),
        publisher: z.string().optional().describe("Required for collective-push drafts: original publisher or X account"),
        postId: z.string().regex(/^\d{8,22}$/).optional().describe("Required for collective pushes: X post ID matching sourceUrl"),
        issuedAt: z.string().datetime({ offset: true }).optional().describe("Required for collective pushes: ISO issue time"),
        expiresAt: z.string().datetime({ offset: true }).optional().describe("Required for collective pushes: ISO expiry time"),
        angle: z.string().optional().describe("Required for collective pushes: proposed marketing angle, not verified fact"),
        shareToSwm: z.boolean().optional().describe("Retired; curator alone shares accepted drafts"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, text, sourceUrl, publisher, postId, issuedAt, expiresAt, angle, shareToSwm }) => {
      requireWrite();
      if (shareToSwm) throw new Error("SWM sharing requires curator review; submit Working Memory draft only");
      const slug = String(name).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
      if (/^swarm-policy/i.test(slug) || /swarm.policy/i.test(slug)) throw new Error("Owner policy names are reserved");
      const collectivePush = /collective[-_ ]?push/i.test(name);
      if (collectivePush) {
        if (!sourceUrl || !publisher || !postId || !issuedAt || !expiresAt || !angle) throw new Error("Collective pushes require sourceUrl, publisher, postId, issuedAt, expiresAt, angle");
        const parsed = new URL(sourceUrl);
        if (!/^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(parsed.hostname) || !new RegExp(`/status/${postId}/?$`).test(parsed.pathname)) throw new Error("sourceUrl must match X postId");
        if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) <= Date.now()) throw new Error("collective push expiry must be future and after issue time");
      }
      const subject = `https://www.dkgswarm.com/ka/${encodeURIComponent(slug)}`;
      const lit = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
      const created = await dkgFetch("/api/knowledge-assets", {
        method: "POST",
        body: {
          contextGraphId: GRAPH_ID,
          name: slug,
          finalize: false,
          alsoShareSwm: false,
          quads: [
            {
              subject,
              predicate: "http://www.w3.org/2000/01/rdf-schema#label",
              object: lit(name),
            },
            {
              subject,
              predicate: "http://www.w3.org/2000/01/rdf-schema#comment",
              object: lit(text),
            },
            ...(sourceUrl ? [{ subject, predicate: "https://schema.org/url", object: sourceUrl }] : []),
            ...(publisher ? [{ subject, predicate: "https://schema.org/publisher", object: lit(publisher) }] : []),
            ...(postId ? [{ subject, predicate: "https://schema.org/identifier", object: lit(postId) }] : []),
            { subject, predicate: "https://schema.org/dateCreated", object: lit(issuedAt || new Date().toISOString()) },
            ...(expiresAt ? [{ subject, predicate: "https://schema.org/expires", object: lit(expiresAt) }] : []),
            ...(angle ? [{ subject, predicate: "https://www.dkgswarm.com/ontology/curator/proposedAngle", object: lit(angle) }] : []),
            ...(collectivePush ? [{ subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "https://www.dkgswarm.com/ontology/curator/CollectivePush" }] : []),
          ],
        },
      });
      // Queue every community draft; do not trust supplied name or content as an instruction.
      enqueueCuratorDraft(slug);
      if (process.env.TRAC_CURATOR_AUTOSTART !== "0") triggerCurator();
      return json({ contextGraphId: GRAPH_ID, layer: "working-memory", name: slug, created, curatorReview: "queued" });
    }
  );

  registerTool(
    "share_to_swm",
    {
      description: "Retired: SWM promotion is reserved for curator review. Never publishes Verifiable Memory.",
      inputSchema: {
        name: z.string().describe("Existing knowledge asset name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      throw new Error("SWM sharing requires curator review; submit Working Memory draft only");
    }
  );

  return server;
}

if (!nodeToken) {
  console.error("DKG API token missing");
  process.exit(1);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

function secretsEqual(a, b) {
  if (a == null || b == null) return false;
  return timingSafeEqual(digest(a), digest(b));
}

function writerGrantId(code) {
  return createHash("sha256").update(`writer-code:${code}`).digest("hex");
}

function masterWriterGrantId(password) {
  return createHash("sha256").update(`master-writer:${password}`).digest("hex");
}

function writerGrantActive(grantId) {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(WRITER_CODES_PATH, "utf8"));
  } catch {
    return false;
  }
  if (!grantId) return !db.legacyWriterRevoked;
  if (ALLOW_MASTER_WRITER && WRITER_PASSWORD && grantId === masterWriterGrantId(WRITER_PASSWORD)) return true;
  const used = Array.isArray(db.used) ? db.used : [];
  return used.some((row) => row?.code && (row.grantId || writerGrantId(row.code)) === grantId);
}

function writerCredentialsActive(data) {
  return !data?.scopes?.includes("dkg:write") || writerGrantActive(data.writerGrantId);
}

function writeJsonAtomic(filePath, data) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function withFileLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  let lock;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.unlinkSync(lockPath);
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (lock === undefined) throw new Error("Writer-code registry is busy");
  try {
    return operation();
  } finally {
    fs.closeSync(lock);
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

function consumeWriterSecret(got, { activate = () => true, deactivate = () => {} } = {}) {
  const offered = String(got || "").trim();
  if (!offered) return false;
  if (ALLOW_MASTER_WRITER && WRITER_PASSWORD && secretsEqual(offered, WRITER_PASSWORD)) {
    const grantId = masterWriterGrantId(WRITER_PASSWORD);
    return activate(grantId) ? { grantId } : false;
  }
  return withFileLock(WRITER_CODES_PATH, () => {
      const db = JSON.parse(fs.readFileSync(WRITER_CODES_PATH, "utf8"));
      const unused = Array.isArray(db.unused) ? db.unused : [];
      const idx = unused.findIndex((row) => row && secretsEqual(row.code, offered));
      if (idx === -1) return false;
      const row = unused[idx];
      const grantId = writerGrantId(row.code);
      if (!activate(grantId)) return false;
      unused.splice(idx, 1);
      db.used = Array.isArray(db.used) ? db.used : [];
      db.used.push({ ...row, grantId, usedAt: new Date().toISOString() });
      try {
        writeJsonAtomic(WRITER_CODES_PATH, db);
      } catch (error) {
        deactivate(grantId);
        throw error;
      }
      return { grantId };
  });
}

const issuerUrl = new URL(PUBLIC_URL);
const mcpUrl = new URL(`${PUBLIC_URL}/mcp`);
const store = createStore([grokClient()]);
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;

const provider = {
  get clientsStore() {
    return store;
  },
  async authorize(client, params, res) {
    const code = randomToken();
    store.putCode(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: ["dkg:read"],
      writerGrantId: null,
      resource: params.resource?.href,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    res.redirect(302, target.toString());
  },
  async challengeForAuthorizationCode(client, authorizationCode) {
    const data = store.peekCode(authorizationCode);
    if (!data || data.clientId !== client.client_id) throw new Error("Invalid authorization code");
    return data.codeChallenge;
  },
  async exchangeAuthorizationCode(client, authorizationCode, _verifier, redirectUri) {
    const data = store.peekCode(authorizationCode);
    if (!data || data.clientId !== client.client_id) throw new Error("Invalid authorization code");
    if (data.expiresAt < Date.now()) throw new Error("Authorization code expired");
    if (redirectUri && redirectUri !== data.redirectUri) throw new Error("redirect_uri mismatch");
    if (!writerCredentialsActive(data)) throw new Error("Writer grant revoked");
    const consumed = store.takeCode(authorizationCode);
    if (!consumed) throw new Error("Invalid authorization code");
    return issueTokens(client.client_id, consumed.scopes, consumed.resource, consumed.writerGrantId);
  },
  async exchangeRefreshToken(client, refreshToken, scopes) {
    const data = store.getToken(refreshToken);
    if (!data || data.type !== "refresh" || data.clientId !== client.client_id) {
      throw new Error("Invalid refresh token");
    }
    if (data.expiresAt < Date.now()) throw new Error("Refresh token expired");
    if (!writerCredentialsActive(data)) throw new Error("Writer grant revoked");
    let requestedScopes = resolveRefreshScopes(data.scopes, scopes);
    if (data.writerGrantId) {
      requestedScopes = Array.from(new Set([...requestedScopes, "dkg:read", "dkg:write"]));
    }
    store.deleteToken(refreshToken);
    return issueTokens(
      client.client_id,
      requestedScopes,
      data.resource,
      data.writerGrantId,
      data.tokenFamilyId
    );
  },
  async verifyAccessToken(token) {
    const data = store.getToken(token);
    if (!data || data.type !== "access" || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }
    if (data.resource !== mcpUrl.href) throw new Error("Token resource mismatch");
    if (!writerCredentialsActive(data)) throw new Error("Writer grant revoked");
    return {
      token,
      clientId: data.clientId,
      tokenFamilyId: data.tokenFamilyId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource,
    };
  },
};

function issueTokens(clientId, scopes, resource, writerGrantId = null, tokenFamilyId = randomToken()) {
  const access = randomToken();
  const refresh = randomToken();
  store.putToken(access, {
    type: "access",
    clientId,
    scopes,
    writerGrantId,
    tokenFamilyId,
    resource,
    expiresAt: Date.now() + ACCESS_TTL * 1000,
  });
  store.putToken(refresh, {
    type: "refresh",
    clientId,
    scopes,
    writerGrantId,
    tokenFamilyId,
    resource,
    expiresAt: Date.now() + REFRESH_TTL * 1000,
  });
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: ACCESS_TTL,
    scope: (scopes || []).join(" "),
    refresh_token: refresh,
  };
}

const app = createMcpExpressApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.use(express.urlencoded({ extended: false }));

const oauthMetadata = createOAuthMetadata({
  provider,
  issuerUrl,
  scopesSupported: ["dkg:read", "dkg:write"],
});
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpUrl,
    scopesSupported: ["dkg:read", "dkg:write"],
    resourceName: "TRAC marketing DKG",
  })
);
app.use("/.well-known/oauth-protected-resource", (req, res, next) => {
  if (req.path !== "/" && req.path !== "") return next();
  res.json({
    resource: mcpUrl.href,
    authorization_servers: [issuerUrl.href],
    scopes_supported: ["dkg:read", "dkg:write"],
    resource_name: "TRAC marketing DKG",
  });
});
app.use("/register", clientRegistrationHandler({ clientsStore: store }));
app.use("/token", tokenHandler({ provider }));

app.all("/authorize", async (req, res) => {
  try {
    const src = req.method === "POST" ? req.body : req.query;
    const validationError = validateAuthorizationRequest(src, mcpUrl.href);
    if (validationError) {
      res.status(400).json({ error: "invalid_request", error_description: validationError });
      return;
    }
    const client = await store.getClient(src.client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    if (!client.redirect_uris?.includes(src.redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not registered" });
      return;
    }
    await provider.authorize(
      client,
      {
        state: src.state,
        scopes: ["dkg:read"],
        redirectUri: src.redirect_uri,
        codeChallenge: src.code_challenge,
        resource: src.resource ? new URL(src.resource) : mcpUrl,
      },
      res
    );
  } catch (error) {
    console.error("authorize error", error);
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
  }
});

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);

app.get("/health", (_req, res) => {
  res.json({ ok: true, graph: GRAPH_ID, mcp: "/mcp" });
});

const swarmStats = createSwarmStats({ activitySnapshot: () => activity.snapshot(),
  querySharedPosts: () => dkgFetch("/api/query", { method: "POST", timeoutMs: 10000,
    body: { contextGraphId: GRAPH_ID, view: "shared-working-memory", sparql: sharedPostCountQuery } }) });
app.get("/api/swarm/stats", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=10");
  res.json(await swarmStats.snapshot());
});

// Public memory reads only curator-shared memory. Draft Working Memory stays private.
app.get("/api/swarm/memory", async (req, res) => {
  try {
    if (req.query.format !== undefined) return res.status(404).json({ error: "Unknown memory format" });
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return res.status(400).json({ error: "Invalid offset" });
    const q = req.query.q ?? "";
    const source = req.query.source ?? "";
    if (typeof q !== "string" || q.length > 200 || typeof source !== "string" || source.length > 200) {
      return res.status(400).json({ error: "Search and source must be strings of at most 200 characters" });
    }
    const dates = {};
    for (const name of ["from", "to"]) {
      const value = req.query[name];
      if (value === undefined || value === "") continue;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
        return res.status(400).json({ error: "Dates must be valid YYYY-MM-DD values" });
      }
      dates[name] = value;
    }
    if (dates.from && dates.to && dates.from > dates.to) return res.status(400).json({ error: "Date range is reversed" });
    const filters = [];
    if (q.trim()) filters.push(`FILTER(CONTAINS(LCASE(STR(?label)), ${JSON.stringify(q.trim().toLowerCase())}) || CONTAINS(LCASE(STR(?comment)), ${JSON.stringify(q.trim().toLowerCase())}))`);
    if (source.trim()) filters.push(`FILTER(CONTAINS(LCASE(STR(?source)), ${JSON.stringify(source.trim().toLowerCase())}))`);
    if (dates.from) filters.push(`FILTER(xsd:dateTime(?date) >= ${JSON.stringify(`${dates.from}T00:00:00Z`)}^^xsd:dateTime)`);
    if (dates.to) filters.push(`FILTER(xsd:dateTime(?date) < ${JSON.stringify(new Date(Date.parse(dates.to) + 86400000).toISOString())}^^xsd:dateTime)`);
    const pageSize = 80;
    const data = await dkgFetch("/api/query", {
      method: "POST",
      body: {
        contextGraphId: GRAPH_ID,
        view: "shared-working-memory",
        sparql: `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        SELECT ?s ?label ?comment ?source (STR(?date) AS ?createdAt) WHERE {
          ?s <http://www.w3.org/2000/01/rdf-schema#comment> ?comment .
          OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label }
          OPTIONAL { ?s <https://schema.org/url> ?source }
          OPTIONAL { ?s <https://schema.org/dateCreated> ?date }
          FILTER(!CONTAINS(STR(?s), "/swarm-policy-v"))
          ${filters.join("\n")}
        } ORDER BY DESC(?s) LIMIT ${pageSize + 1} OFFSET ${offset}`,
      },
    });
    const literal = (value) => {
      if (typeof value !== "string") return "";
      if (value.startsWith('"')) {
        try { return JSON.parse(value); } catch { return value.replace(/^"|"$/g, ""); }
      }
      return value;
    };
    const bindings = data?.result?.bindings || [];
    const entries = bindings.slice(0, pageSize).filter((row) =>
      typeof row.s === "string" && typeof row.comment === "string" &&
      row.s.startsWith("https://www.dkgswarm.com/ka/") && !row.s.includes("/swarm-policy-v")
    ).map((row) => ({
      id: row.s,
      title: literal(row.label) || row.s.split("/").pop(),
      text: literal(row.comment),
      source: /^https?:\/\//.test(row.source || "") ? row.source : null,
      createdAt: row.createdAt ? literal(row.createdAt) : null,
    }));
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ graph: GRAPH_ID, layer: "shared-working-memory", entries, nextOffset: bindings.length > pageSize ? offset + pageSize : null });
  } catch (error) {
    console.error("public memory feed failed", error);
    res.status(503).json({ error: "Shared memory temporarily unavailable" });
  }
});

app.use("/mcp", async (req, res, next) => {
  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const www = `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`;
  if (!got) {
    res.set("WWW-Authenticate", www);
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return;
  }
  try {
    const auth = await provider.verifyAccessToken(got);
    const method = typeof req.body?.method === "string" ? req.body.method : req.method;
    const tool = method === "tools/call" ? req.body?.params?.name : null;
    const startedAt = Date.now();
    const context = { scopes: auth.scopes || [], token: got, family: auth.tokenFamilyId, toolOk: false };
    res.on("finish", () => {
      try { activity.record({ family: auth.tokenFamilyId, tool, graph: GRAPH_ID, ok: res.statusCode < 400 && context.toolOk }); }
      catch (error) { console.error("activity write failed", error); }
      console.log(
        "mcp request",
        JSON.stringify({ clientId: auth.clientId, method, status: res.statusCode, durationMs: Date.now() - startedAt })
      );
    });
    authStore.run(context, () => next());
  } catch {
    res.set("WWW-Authenticate", www);
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  }
});

app.post("/mcp", async (req, res) => {
  const server = getServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("MCP error", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`TRAC marketing DKG MCP http://${HOST}:${PORT}/mcp graph=${GRAPH_ID}`);
});
