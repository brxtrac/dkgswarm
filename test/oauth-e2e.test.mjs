import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

test("isolated server completes discovery, DCR, PKCE exchange, and MCP initialize", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dkg-oauth-e2e-"));
  const port = await freePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      HOME: dir,
      DKG_MCP_HOST: "127.0.0.1",
      DKG_MCP_PORT: String(port),
      DKG_MCP_PUBLIC_URL: publicUrl,
      DKG_PUBLIC_GRAPH_ID: "trac-marketing",
      DKG_API_URL: "http://127.0.0.1:1",
      DKG_API_TOKEN: "isolated-test-token",
      DKG_MCP_OAUTH_STORE: path.join(dir, "oauth.json"),
      DKG_MCP_WRITER_CODES: path.join(dir, "writer-codes.json"),
      DKG_MCP_POLICY_CURRENT: path.join(dir, "policy-current.json"),
      DKG_MCP_ACTIVITY_STORE: path.join(dir, "activity.sqlite"),
      TRAC_CURATOR_INTAKE: path.join(dir, "intake.sqlite"),
      DKG_MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    if (child.exitCode !== null) break;
    try { ready = (await fetch(`${publicUrl}/health`)).ok; } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, `server did not start\n${logs}`);

  const prm = await fetch(`${publicUrl}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(prm.status, 200);
  const prmBody = await prm.json();
  assert.equal(prmBody.resource, `${publicUrl}/mcp`);
  assert.deepEqual(prmBody.authorization_servers, [`${publicUrl}/`]);

  const metadata = await (await fetch(`${publicUrl}/.well-known/oauth-authorization-server`)).json();
  assert.equal(metadata.issuer, `${publicUrl}/`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata.registration_endpoint, `${publicUrl}/register`);

  const unauth = await fetch(`${publicUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://claude.ai" },
    body: "{}",
  });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate"), /resource_metadata=/);
  assert.match(unauth.headers.get("www-authenticate"), /scope="dkg:read"/);
  assert.equal(unauth.headers.get("access-control-allow-origin"), "https://claude.ai");

  const preflight = await fetch(`${publicUrl}/mcp`, {
    method: "OPTIONS",
    headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://claude.ai");

  const rejectedOrigin = await fetch(`${publicUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(rejectedOrigin.status, 403);

  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const registration = await fetch(`${publicUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Claude",
    }),
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();

  const rejectedClient = await fetch(`${publicUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"], token_endpoint_auth_method: "none" }),
  });
  assert.equal(rejectedClient.status, 400);

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "dkg:read offline_access",
    state: "e2e-state",
  });
  const wrongResource = await fetch(`${publicUrl}/authorize?${new URLSearchParams({ ...Object.fromEntries(params), resource: "https://other.example/mcp" })}`, { redirect: "manual" });
  assert.equal(wrongResource.status, 400);

  const authorization = await fetch(`${publicUrl}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    redirect: "manual",
  });
  assert.equal(authorization.status, 302);
  const target = new URL(authorization.headers.get("location"));
  assert.equal(target.origin + target.pathname, redirect);
  assert.equal(target.searchParams.get("state"), "e2e-state");
  const code = target.searchParams.get("code");
  assert.ok(code);

  const tokenResponse = await fetch(`${publicUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    }),
  });
  const tokenText = await tokenResponse.text();
  assert.equal(tokenResponse.status, 200, tokenText);
  const tokens = JSON.parse(tokenText);
  assert.equal(tokens.token_type, "bearer");
  assert.equal(tokens.scope, "dkg:read");

  const initialize = await fetch(`${publicUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
    }),
  });
  assert.equal(initialize.status, 200);
  assert.match(await initialize.text(), /serverInfo/);

  const getMcp = await fetch(`${publicUrl}/mcp`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(getMcp.status, 405);
  assert.equal(getMcp.headers.get("allow"), "POST");
});
