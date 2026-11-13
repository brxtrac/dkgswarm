import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createStore, isRedirectAllowed } from "../oauth.mjs";
import { createOAuthProvider } from "../oauth-provider.mjs";
import { isWriterInvitationActive, writerInvitationExpiry, WRITER_INVITATION_TTL_MS } from "../writer-invitations.mjs";

const resource = "https://www.dkgswarm.com/mcp";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-provider-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "oauth.json");
  const store = createStore([], filename);
  let revoked = false;
  const provider = createOAuthProvider({ store, mcpUrl: new URL(resource), writerCredentialsActive: data => !data.writerGrantId || !revoked });
  return { store, provider, filename, revoke() { revoked = true; } };
}

async function endpoint(t, f) {
  const app = express();
  app.use("/register", clientRegistrationHandler({ clientsStore: f.store, rateLimit: false }));
  app.use("/token", tokenHandler({ provider: f.provider, rateLimit: false }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (route, body, json = false) => {
    const response = await fetch(base + route, {
      method: "POST", headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded" },
      body: json ? JSON.stringify(body) : new URLSearchParams(body),
    });
    return { status: response.status, body: await response.json() };
  };
}

test("callback validation restricts protocols, normalizes IPv6, and preserves exact host boundaries", () => {
  for (const url of ["https://grok.com/callback", "https://www.cursor.com/agents/mcp/oauth/callback", "http://127.0.0.1:8787/callback", "http://localhost/callback", "http://[::1]:8787/callback", "https://[::1]/callback"]) {
    assert.equal(isRedirectAllowed(url), true, url);
  }
  for (const url of ["https://sub.grok.com/callback", "https://sub.claude.ai/callback", "http://grok.com/callback", "ftp://grok.com/callback", "ftp://localhost/callback", "https://grok.com.evil.example/callback", "https://unapproved.example/callback", "https://user:password@grok.com/callback", "https://grok.com/callback#fragment"]) {
    assert.equal(isRedirectAllowed(url), false, url);
  }
});

test("writer invitations have finite expiry and reject undated or malformed legacy rows", () => {
  const now = Date.now();
  const createdAt = new Date(now - 1000).toISOString();
  const row = { createdAt };
  assert.equal(writerInvitationExpiry(row), Date.parse(createdAt) + WRITER_INVITATION_TTL_MS);
  assert.equal(isWriterInvitationActive(row, now), true);
  assert.equal(isWriterInvitationActive(row, writerInvitationExpiry(row)), false);
  assert.equal(isWriterInvitationActive({ createdAt: new Date(now - WRITER_INVITATION_TTL_MS).toISOString() }, now), false);
  assert.equal(writerInvitationExpiry({ ...row, expiresAt: new Date(now + 30 * WRITER_INVITATION_TTL_MS).toISOString() }), writerInvitationExpiry(row));
  assert.equal(isWriterInvitationActive({ ...row, expiresAt: new Date(now - 500).toISOString() }, now), false);
  for (const invalid of [{}, { expiresAt: new Date(now + 1000).toISOString() }, { createdAt: "bad" }, { ...row, expiresAt: "bad" }, { ...row, expiresAt: null }, { createdAt: new Date(now + 1000).toISOString() }]) {
    assert.equal(isWriterInvitationActive(invalid, now), false);
  }
  const source = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const expiryGate = source.indexOf("if (!isWriterInvitationActive(row)) return false;");
  const activation = source.indexOf("if (!activate(grantId)) return false;");
  assert.ok(expiryGate >= 0 && activation >= 0);
  assert.ok(expiryGate < activation);
});

test("expiry cleanup preserves live token bytes and client metadata; corrupt store fails closed", t => {
  const f = fixture(t);
  const now = Date.now();
  const live = { type: "refresh", scopes: ["dkg:read", "dkg:write"], writerGrantId: "fixture-grant", tokenFamilyId: "fixture-family", expiresAt: now + 3600000 };
  const db = { clients: { fixture: { client_id: "fixture" } }, codes: { old: { expiresAt: now - 1 }, live: { expiresAt: now + 3600000 } }, tokens: { old: { expiresAt: now - 1 }, live, unknown: { type: "access" } } };
  fs.writeFileSync(f.filename, JSON.stringify(db));
  assert.equal(f.store.cleanupExpired(), 2);
  assert.deepEqual(f.store.getToken("live"), live);
  assert.deepEqual(f.store.getToken("unknown"), db.tokens.unknown);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.filename)).clients, db.clients);
  assert.equal(f.store.cleanupExpired(), 0);
  fs.writeFileSync(f.filename, "invalid-json");
  assert.throws(() => createStore([], f.filename), SyntaxError);
  assert.equal(fs.readFileSync(f.filename, "utf8"), "invalid-json");
});

test("isolated SDK registration, PKCE exchange, replay rejection and refresh narrowing", async t => {
  const f = fixture(t);
  const post = await endpoint(t, f);
  const redirect = "http://[::1]:8787/callback";
  const registration = await post("/register", { redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, true);
  assert.equal(registration.status, 201);
  const client = registration.body;
  const rejected = await post("/register", { redirect_uris: ["http://grok.com/callback"], token_endpoint_auth_method: "none" }, true);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "invalid_client_metadata");
  const verifier = "isolated-test-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  let target;
  await f.provider.authorize(client, { redirectUri: redirect, resource: new URL(resource), codeChallenge: challenge, state: "fixture-state" }, { redirect(status, url) { assert.equal(status, 302); target = new URL(url); } });
  assert.equal(target.searchParams.get("state"), "fixture-state");
  const code = target.searchParams.get("code");
  const form = { grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: redirect, resource };
  const wrongPkce = await post("/token", { ...form, code_verifier: "wrong-verifier" });
  assert.equal(wrongPkce.status, 400);
  assert.equal(wrongPkce.body.error, "invalid_grant");
  const wrongRedirect = await post("/token", { ...form, redirect_uri: "http://127.0.0.1/callback" });
  assert.equal(wrongRedirect.body.error, "invalid_grant");
  const missingRedirect = { ...form };
  delete missingRedirect.redirect_uri;
  assert.equal((await post("/token", missingRedirect)).body.error, "invalid_grant");
  const wrongResource = await post("/token", { ...form, resource: "https://other.example/mcp" });
  assert.equal(wrongResource.body.error, "invalid_grant");
  assert.ok(f.store.peekCode(code));
  const issued = await post("/token", form);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.scope, "dkg:read");
  const replay = await post("/token", form);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal(f.store.upgradeTokenFamily(issued.body.access_token, "fixture-grant"), true);
  const oldFamily = f.store.getToken(issued.body.access_token).tokenFamilyId;
  const refresh = { grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued.body.refresh_token, scope: "dkg:read" };
  const narrowed = await post("/token", refresh);
  assert.equal(narrowed.status, 200);
  assert.equal(narrowed.body.scope, "dkg:read");
  const narrowedData = f.store.getToken(narrowed.body.access_token);
  assert.equal(narrowedData.writerGrantId, null);
  assert.notEqual(narrowedData.tokenFamilyId, oldFamily);
  f.store.upgradeTokenFamily(issued.body.access_token, "another-fixture-grant");
  assert.deepEqual(f.store.getToken(narrowed.body.access_token).scopes, ["dkg:read"]);
  const escalation = await post("/token", { ...refresh, refresh_token: narrowed.body.refresh_token, scope: "dkg:write" });
  assert.equal(escalation.status, 400);
  assert.equal(escalation.body.error, "invalid_scope");
  assert.ok(f.store.getToken(narrowed.body.refresh_token));
  const replayRefresh = await post("/token", refresh);
  assert.equal(replayRefresh.body.error, "invalid_grant");
  const rotated = await post("/token", { ...refresh, refresh_token: narrowed.body.refresh_token });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.scope, "dkg:read");
  await f.provider.verifyAccessToken(rotated.body.access_token);
});

test("provider rejects expired, wrong-client, wrong-resource and revoked grants with typed errors", async t => {
  const f = fixture(t);
  const client = { client_id: "fixture-client" };
  const valid = { type: "refresh", clientId: client.client_id, scopes: ["dkg:read", "dkg:write"], resource, writerGrantId: "fixture-grant", expiresAt: Date.now() + 60000 };
  for (const [label, patch] of [["expired", { expiresAt: Date.now() - 1 }], ["wrong-client", { clientId: "other" }], ["wrong-resource", { resource: "https://other.example/mcp" }]]) {
    f.store.putToken(label, { ...valid, ...patch });
    await assert.rejects(f.provider.exchangeRefreshToken(client, label), InvalidGrantError);
  }
  f.store.putToken("revoked", valid);
  f.revoke();
  await assert.rejects(f.provider.exchangeRefreshToken(client, "revoked"), InvalidGrantError);
  f.store.putToken("revoked-access", { ...valid, type: "access" });
  await assert.rejects(f.provider.verifyAccessToken("revoked-access"), InvalidTokenError);
  await assert.rejects(f.provider.verifyAccessToken("missing"), InvalidTokenError);
  await assert.rejects(f.provider.challengeForAuthorizationCode(client, "missing"), InvalidGrantError);
  const post = await endpoint(t, f);
  await f.store.registerClient({ ...client, redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none" });
  for (const token of ["expired", "wrong-client", "wrong-resource", "revoked", "missing"]) {
    const result = await post("/token", { grant_type: "refresh_token", client_id: client.client_id, refresh_token: token });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_grant");
  }
});

test("malformed refresh scope parameters fail as typed invalid_grant without consuming the token", async t => {
  const f = fixture(t);
  const client = { client_id: "fixture-client" };
  f.store.putToken("malformed", { type: "refresh", clientId: client.client_id, scopes: ["dkg:read"], resource, expiresAt: Date.now() + 60000 });
  for (const scopes of [null, "dkg:read", [42], [""]]) {
    await assert.rejects(f.provider.exchangeRefreshToken(client, "malformed", scopes), InvalidGrantError);
  }
  const post = await endpoint(t, f);
  await f.store.registerClient({ ...client, redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none" });
  const blank = await post("/token", { grant_type: "refresh_token", client_id: client.client_id, refresh_token: "malformed", scope: "" });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error, "invalid_grant");
  assert.ok(f.store.getToken("malformed"));
});

test("writer refresh without scope keeps writer grant and family; expiry pruning runs on normal saves", async t => {
  const f = fixture(t);
  const data = { type: "refresh", clientId: "fixture", scopes: ["dkg:read", "dkg:write"],
    resource, writerGrantId: "fixture-grant", tokenFamilyId: "fixture-family", expiresAt: Date.now() + 60000 };
  f.store.putToken("writer-refresh", data);
  const tokens = await f.provider.exchangeRefreshToken({ client_id: "fixture" }, "writer-refresh");
  assert.equal(tokens.scope, "dkg:read dkg:write");
  const saved = f.store.getToken(tokens.refresh_token);
  assert.equal(saved.writerGrantId, data.writerGrantId);
  assert.equal(saved.tokenFamilyId, data.tokenFamilyId);
  f.store.putToken("expired", { type: "access", expiresAt: Date.now() - 1 });
  assert.equal(f.store.getToken("expired"), null);
  assert.ok(f.store.getToken(tokens.access_token));
  assert.ok(f.store.getToken(tokens.refresh_token));
});
