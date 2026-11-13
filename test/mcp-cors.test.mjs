import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { isCorsOriginAllowed, mcpCors } from "../mcp-cors.mjs";

test("browser origin policy reflects known clients and loopback only", () => {
  for (const origin of ["https://claude.ai", "https://chatgpt.com", "https://cursor.com", "https://www.cursor.com", "http://localhost:5173", "http://127.0.0.1:8787", "http://[::1]:3000"]) {
    assert.equal(isCorsOriginAllowed(origin), true, origin);
  }
  for (const origin of ["https://evil.example", "https://claude.ai.evil.example", "null", "https://claude.ai/path", "https://user:pass@claude.ai"]) {
    assert.equal(isCorsOriginAllowed(origin), false, origin);
  }
});

test("configured CORS origins replace the default list", () => {
  const modulePath = fileURLToPath(new URL("../mcp-cors.mjs", import.meta.url));
  const script = `
    import { isCorsOriginAllowed } from ${JSON.stringify(modulePath)};
    const checks = {
      custom: isCorsOriginAllowed("https://example.test"),
      defaultGone: isCorsOriginAllowed("https://claude.ai"),
      loopback: isCorsOriginAllowed("http://localhost:9999"),
    };
    if (!checks.custom || checks.defaultGone || !checks.loopback) {
      console.error(JSON.stringify(checks));
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, DKG_MCP_CORS_ORIGINS: "https://example.test" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

async function withServer(t) {
  const app = express();
  app.use("/mcp", mcpCors);
  app.post("/mcp", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("preflight and authorized-origin responses carry scoped CORS headers", async (t) => {
  const base = await withServer(t);
  const preflight = await fetch(`${base}/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://claude.ai",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,mcp-protocol-version",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://claude.ai");
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
  assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
  assert.equal(preflight.headers.get("vary"), "Origin");

  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Origin: "https://claude.ai", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://claude.ai");
});

test("unknown browser origin is rejected and non-browser requests pass", async (t) => {
  const base = await withServer(t);
  const rejected = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);

  const cli = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(cli.status, 200);
});
