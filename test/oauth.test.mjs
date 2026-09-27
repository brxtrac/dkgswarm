import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore, resolveRefreshScopes, validateAuthorizationRequest } from "../oauth.mjs";

test("reader refresh cannot escalate to write", () => {
  assert.throws(
    () => resolveRefreshScopes(["dkg:read"], ["dkg:read", "dkg:write"]),
    /Requested scope exceeds original grant/
  );
});

test("writer refresh may narrow to read", () => {
  assert.deepEqual(resolveRefreshScopes(["dkg:read", "dkg:write"], ["dkg:read"]), ["dkg:read"]);
});

test("refresh without requested scopes keeps original scopes", () => {
  assert.deepEqual(resolveRefreshScopes(["dkg:read", "dkg:write"]), ["dkg:read", "dkg:write"]);
});

test("writer upgrade applies only to current token family", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-upgrade-test-"));
  const storePath = path.join(dir, "oauth.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore([], storePath);
  const expiresAt = Date.now() + 60_000;
  store.putToken("access-a", { type: "access", scopes: ["dkg:read"], tokenFamilyId: "family-a", expiresAt });
  store.putToken("refresh-a", { type: "refresh", scopes: ["dkg:read"], tokenFamilyId: "family-a", expiresAt });
  store.putToken("access-b", { type: "access", scopes: ["dkg:read"], tokenFamilyId: "family-b", expiresAt });

  assert.equal(store.upgradeTokenFamily("access-a", "grant-a"), true);
  assert.deepEqual(store.getToken("access-a").scopes, ["dkg:read", "dkg:write"]);
  assert.deepEqual(store.getToken("refresh-a").scopes, ["dkg:read", "dkg:write"]);
  assert.equal(store.getToken("refresh-a").writerGrantId, "grant-a");
  assert.deepEqual(store.getToken("access-b").scopes, ["dkg:read"]);

  assert.equal(store.revokeTokenFamilyGrant("access-a", "grant-a"), true);
  assert.deepEqual(store.getToken("access-a").scopes, ["dkg:read"]);
  assert.deepEqual(store.getToken("refresh-a").scopes, ["dkg:read"]);
  assert.equal(store.getToken("refresh-a").writerGrantId, null);
  assert.equal(store.revokeTokenFamilyGrant("access-b", "grant-a"), false);
});

test("legacy or expired access token cannot upgrade", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-upgrade-test-"));
  const storePath = path.join(dir, "oauth.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore([], storePath);
  store.putToken("legacy", { type: "access", scopes: ["dkg:read"], expiresAt: Date.now() + 60_000 });
  store.putToken("expired", { type: "access", scopes: ["dkg:read"], tokenFamilyId: "expired", expiresAt: 0 });

  assert.equal(store.upgradeTokenFamily("legacy", "grant-a"), false);
  assert.equal(store.upgradeTokenFamily("expired", "grant-a"), false);
});

test("writer upgrade reaches rotated tokens when refresh preserves family", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-refresh-family-test-"));
  const storePath = path.join(dir, "oauth.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore([], storePath);
  const expiresAt = Date.now() + 60_000;
  store.putToken("old-access", { type: "access", scopes: ["dkg:read"], tokenFamilyId: "family-a", expiresAt });
  store.putToken("new-access", { type: "access", scopes: ["dkg:read"], tokenFamilyId: "family-a", expiresAt });
  store.putToken("new-refresh", { type: "refresh", scopes: ["dkg:read"], tokenFamilyId: "family-a", expiresAt });

  assert.equal(store.upgradeTokenFamily("old-access", "grant-a"), true);
  assert.deepEqual(store.getToken("new-access").scopes, ["dkg:read", "dkg:write"]);
  assert.deepEqual(store.getToken("new-refresh").scopes, ["dkg:read", "dkg:write"]);
  assert.equal(store.getToken("new-refresh").writerGrantId, "grant-a");
});

test("authorization requires reader-only PKCE request for exact resource", () => {
  const valid = {
    client_id: "client",
    redirect_uri: "http://127.0.0.1/callback",
    response_type: "code",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    scope: "dkg:read",
    resource: "https://www.dkgswarm.com/mcp",
  };
  assert.equal(validateAuthorizationRequest(valid, valid.resource), null);
  assert.equal(validateAuthorizationRequest({ ...valid, scope: "dkg:read dkg:write" }, valid.resource), null);
  assert.match(validateAuthorizationRequest({ ...valid, scope: "admin" }, valid.resource), /unsupported scope/);
  assert.match(validateAuthorizationRequest({ ...valid, code_challenge_method: "plain" }, valid.resource), /S256/);
  assert.match(validateAuthorizationRequest({ ...valid, resource: "https://example.com/mcp" }, valid.resource), /resource/);
});
