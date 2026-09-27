import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const DATA_PATH = process.env.DKG_MCP_OAUTH_STORE || "/root/dkg-public-mcp/data/oauth.json";
const ALLOWED_REDIRECT_HOSTS = (process.env.DKG_MCP_OAUTH_REDIRECT_HOSTS || "grok.com,x.ai")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const LOOPBACK_REDIRECT_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function load(dataPath = DATA_PATH) {
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch {
    return { clients: {}, codes: {}, tokens: {} };
  }
}

function save(db, dataPath = DATA_PATH) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  const tempPath = path.join(path.dirname(dataPath), `.${path.basename(dataPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, dataPath);
}

function redirectHostAllowed(uri) {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    if (LOOPBACK_REDIRECT_HOSTS.has(host)) return true;
    return ALLOWED_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function createStore(preloadedClients = [], dataPath = DATA_PATH) {
  const db = load(dataPath);
  for (const client of preloadedClients) {
    if (!db.clients[client.client_id]) db.clients[client.client_id] = client;
  }
  save(db, dataPath);
  return {
    async getClient(clientId) {
      return load(dataPath).clients[clientId];
    },
    async registerClient(client) {
      const dbNow = load(dataPath);
      const uris = Array.isArray(client.redirect_uris) ? client.redirect_uris : [];
      if (uris.some((u) => !redirectHostAllowed(u))) {
        throw new InvalidClientMetadataError("redirect_uri host is not allowed");
      }
      dbNow.clients[client.client_id] = client;
      save(dbNow, dataPath);
      console.log("oauth register", client.client_id, uris);
      return client;
    },
    addRedirect(clientId, uri) {
      const dbNow = load(dataPath);
      const client = dbNow.clients[clientId];
      if (!client) return;
      if (!client.redirect_uris.includes(uri) && redirectHostAllowed(uri)) {
        client.redirect_uris.push(uri);
        save(dbNow, dataPath);
        console.log("oauth added redirect", clientId, uri);
      }
    },
    putCode(code, data) {
      const dbNow = load(dataPath);
      dbNow.codes[code] = data;
      save(dbNow, dataPath);
    },
    takeCode(code) {
      const dbNow = load(dataPath);
      const data = dbNow.codes[code];
      if (!data) return null;
      delete dbNow.codes[code];
      save(dbNow, dataPath);
      return data;
    },
    peekCode(code) {
      return load(dataPath).codes[code] || null;
    },
    putToken(token, data) {
      const dbNow = load(dataPath);
      dbNow.tokens[token] = data;
      save(dbNow, dataPath);
    },
    getToken(token) {
      return load(dataPath).tokens[token] || null;
    },
    deleteToken(token) {
      const dbNow = load(dataPath);
      delete dbNow.tokens[token];
      save(dbNow, dataPath);
    },
    getUpgradeableToken(token) {
      const data = load(dataPath).tokens[token];
      if (!data || data.type !== "access" || data.expiresAt < Date.now() || !data.tokenFamilyId) return null;
      return data;
    },
    upgradeTokenFamily(token, writerGrantId) {
      const dbNow = load(dataPath);
      const access = dbNow.tokens[token];
      if (!access || access.type !== "access" || access.expiresAt < Date.now() || !access.tokenFamilyId) return false;
      let updated = false;
      for (const row of Object.values(dbNow.tokens)) {
        if (row?.tokenFamilyId !== access.tokenFamilyId) continue;
        row.scopes = Array.from(new Set([...(row.scopes || []), "dkg:read", "dkg:write"]));
        row.writerGrantId = writerGrantId;
        updated = true;
      }
      if (updated) save(dbNow, dataPath);
      return updated;
    },
    revokeTokenFamilyGrant(token, writerGrantId) {
      const dbNow = load(dataPath);
      const access = dbNow.tokens[token];
      if (!access?.tokenFamilyId) return false;
      let updated = false;
      for (const row of Object.values(dbNow.tokens)) {
        if (row?.tokenFamilyId !== access.tokenFamilyId || row.writerGrantId !== writerGrantId) continue;
        row.scopes = (row.scopes || []).filter((scope) => scope !== "dkg:write");
        row.writerGrantId = null;
        updated = true;
      }
      if (updated) save(dbNow, dataPath);
      return updated;
    },
  };
}

export function isRedirectAllowed(uri) {
  return redirectHostAllowed(uri);
}

export function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function resolveRefreshScopes(grantedScopes = [], requestedScopes = []) {
  const resolved = requestedScopes.length ? requestedScopes : grantedScopes;
  if (resolved.some((scope) => !grantedScopes.includes(scope))) {
    throw new Error("Requested scope exceeds original grant");
  }
  return resolved;
}

export function validateAuthorizationRequest(params, expectedResource) {
  if (!params?.client_id) return "client_id required";
  if (!params.redirect_uri) return "redirect_uri required";
  if (params.response_type !== "code") return "response_type must be code";
  if (!params.code_challenge) return "code_challenge required";
  if (params.code_challenge_method !== "S256") return "code_challenge_method must be S256";
  const scopes = params.scope ? String(params.scope).split(" ").filter(Boolean) : ["dkg:read"];
  if (scopes.some((scope) => !["dkg:read", "dkg:write"].includes(scope))) return "unsupported scope requested";
  if (params.resource !== expectedResource) return "resource must match MCP endpoint";
  return null;
}

export function grokClient() {
  return {
    client_id: "grok",
    client_name: "Grok",
    redirect_uris: [
      "https://grok.com/auth/mcp/callback",
      "https://grok.com/connectors/oauth/callback",
      "https://grok.com/api/mcp/oauth/callback",
      "https://grok.com/connectors-oauth-exchange-code/",
      "https://x.ai/oauth/callback",
      "https://www.cursor.com/agents/mcp/oauth/callback",
      "https://cursor.com/agents/mcp/oauth/callback",
      "http://localhost:8787/callback",
    ],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "dkg:read dkg:write",
  };
}

export function loginPage({ query, error }) {
  const fields = [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "state",
    "resource",
  ];
  const hidden = fields
    .map((name) => {
      const value = query[name];
      if (!value) return "";
      return `<input type="hidden" name="${name}" value="${String(value).replace(/"/g, "&quot;")}">`;
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TRAC marketing DKG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
body{font-family:VT323,monospace;background:#07070a;color:#e6e6e6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#0a0a12;padding:24px;border:3px solid #1b1b24;box-shadow:10px 10px 0 #1b1b24;width:min(460px,92vw)}
h1{font-family:"Press Start 2P",monospace;font-size:.85rem;color:#7cff6b;line-height:1.5;margin:0 0 12px}
p{font-size:1.35rem;line-height:1.35;margin:0 0 12px;color:#c5ccd6}
a{color:#43b6ff}
label{display:block;margin-top:12px;font-size:1.2rem}
input[type=password]{width:100%;padding:10px;border:2px solid #bb86fc;background:#07070a;color:#fff;box-sizing:border-box;margin-top:6px;font-size:1.2rem}
button{margin-top:12px;width:100%;padding:12px;border:0;font-family:"Press Start 2P",monospace;font-size:.65rem;cursor:pointer}
.primary{background:#7cff6b;color:#07070a}
.secondary{background:#2a3340;color:#eee}
.err{color:#ff7597}
.note{font-size:1.15rem;border-left:4px solid #ff7597;padding-left:10px;margin:12px 0}
</style></head>
<body><form method="post" action="/authorize">
<h1>TRAC marketing graph</h1>
<p>Anyone can read. Writing is invite-only.</p>
<p class="note">Need write access? Message <a href="https://t.me/BRX86">@BRX86</a> on Telegram. After approval you get a <strong>one-time code</strong>. It works once, then it expires.</p>
${error ? `<p class="err">${error}</p>` : ""}
${hidden}
<label>One-time write code (only if approved)<br><input type="password" name="password" autocomplete="one-time-code"></label>
<button class="primary" type="submit" name="role" value="read">Continue as reader</button>
<button class="secondary" type="submit" name="role" value="write">Continue as writer</button>
</form></body></html>`;
}
