import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { OxigraphStore } from "@origintrail-official/dkg-storage";
import { createStore } from "../../oauth.mjs";
import { openStore } from "../../collector/watcher.mjs";
import { policyDigest } from "../../policy-integrity.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const comment = "http://www.w3.org/2000/01/rdf-schema#comment";
const label = "http://www.w3.org/2000/01/rdf-schema#label";
const schema = "https://schema.org/";

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function unusedPort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startStack({ port, collector = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dkgswarm-acceptance-"));
  const shared = new OxigraphStore();
  const working = new OxigraphStore();
  const requests = [];
  const children = [];
  const servers = [];
  let unavailable = false;
  const delays = new Map();
  const close = async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    }
    for (const server of servers) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
    await shared.close();
    await working.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    const mcpPort = port || await unusedPort();
    const base = `http://127.0.0.1:${mcpPort}`;
    const policy = { kind: "swarm-coordination-policy", version: 1, contextGraphId: "trac-marketing" };
    const pin = path.join(directory, "policy-current.json");
    fs.writeFileSync(pin, JSON.stringify({ version: 1, sha256: policyDigest(policy) }));
    const quads = [];
    for (let index = 0; index < 85; index++) {
      const subject = `https://www.dkgswarm.com/ka/entry-${String(index).padStart(3, "0")}`;
      quads.push({ subject, predicate: label, object: JSON.stringify(`Entry ${index}`) },
        { subject, predicate: comment, object: JSON.stringify(index === 0 ? "Hidden needle beyond first page" : "Ordinary shared knowledge") },
        { subject, predicate: `${schema}url`, object: index === 0 ? "https://source.example/needle" : "https://other.example/story" });
      if (index !== 1) quads.push({ subject, predicate: `${schema}dateCreated`, object: JSON.stringify(index === 0 ? "2026-09-01T12:00:00Z" : "2026-09-27T12:00:00Z") });
    }
    quads.push({ subject: `${base}/ka/swarm-policy-v1`, predicate: comment, object: JSON.stringify(JSON.stringify(policy)) },
      { subject: "https://x.com/i/status/123456789", predicate: `${schema}articleBody`, object: JSON.stringify("Collected social post") });
    await shared.insert(quads);
    await working.insert([{ subject: "https://www.dkgswarm.com/ka/private-entry", predicate: comment, object: JSON.stringify("Private needle must never appear") }]);

    // SELECT/ASK results come from the official DKG 10.0.14 Oxigraph adapter,
    // not hand-written bindings. The HTTP envelope and draft-create response
    // follow that release's packages/cli/src/daemon/routes/{query,knowledge-assets}.ts.
    // This isolated fixture has no DKG networking, signing, chain, or real credentials.
    const backendApp = express();
    backendApp.use(express.json());
    backendApp.use((req, res, next) => {
      if (req.get("authorization") !== "Bearer synthetic-node-token") return res.status(401).json({ error: "fixture node authentication required" });
      next();
    });
    backendApp.post("/api/query", async (req, res) => {
      requests.push({ route: "/api/query", ...req.body });
      if (unavailable) return res.status(503).json({ error: "fixture unavailable" });
      if (req.body.contextGraphId !== "trac-marketing") return res.status(400).json({ error: "wrong graph" });
      try {
        for (const [term, ms] of delays) if (req.body.sparql.includes(JSON.stringify(term))) await new Promise(resolve => setTimeout(resolve, ms));
        const store = req.body.view === "working-memory" ? working : shared;
        res.json({ result: await store.query(req.body.sparql) });
      } catch (error) { res.status(400).json({ error: error.message }); }
    });
    backendApp.post("/api/knowledge-assets", async (req, res) => {
      requests.push({ route: "/api/knowledge-assets", ...req.body });
      if (req.body.finalize !== false || req.body.alsoShareSwm !== false) return res.status(400).json({ error: "fixture allows drafts only" });
      await working.insert(req.body.quads);
      res.json({ name: req.body.name, assertionUri: `urn:fixture:${req.body.name}`, alreadyExists: false, status: "draft-open", written: req.body.quads.length });
    });
    const backend = http.createServer(backendApp);
    const backendUrl = await listen(backend);
    servers.push(backend);

    const watcherFile = path.join(directory, "watcher.sqlite");
    const watcher = openStore(watcherFile, path.join(directory, "missing.json"), path.join(directory, "missing.jsonl"));
    watcher.prepare(`INSERT INTO observations (post_id,account,kind,post_url,summary,observed_at,classification_json)
      VALUES ('123456789','@fixture','official','https://x.com/i/status/123456789','fixture','2026-09-01T12:00:00Z','{}')`).run();
    watcher.prepare(`INSERT INTO deliveries (post_id,stage,status,next_attempt_at) VALUES ('123456789','raw-dkg','completed','2026-09-01T12:00:00Z')`).run();
    watcher.prepare(`INSERT INTO deliveries (post_id,stage,status,attempts,next_attempt_at,last_error) VALUES ('123456789','derived-dkg','pending',2,'2026-09-01T12:00:00Z','fixture error')`).run();
    watcher.close();
    const reviewFile = path.join(directory, "curator-review.sqlite");
    const review = new DatabaseSync(reviewFile);
    review.exec(`CREATE TABLE decisions (kind TEXT,id TEXT,status TEXT,reason TEXT,updated_at TEXT,PRIMARY KEY(kind,id));
      INSERT INTO decisions VALUES ('community','fixture-promoted','promoted','','2026-09-27T00:00:00Z');
      INSERT INTO decisions VALUES ('community','fixture-rejected','rejected','fixture rejection','2026-09-27T00:00:00Z');`);
    review.close();

    const oauthFile = path.join(directory, "oauth.json");
    const activityFile = path.join(directory, "activity.sqlite");
    const readerToken = "synthetic-reader-token";
    const writerCode = "synthetic-writer-code";
    const store = createStore([], oauthFile);
    store.putToken(readerToken, { type: "access", clientId: "fixture", tokenFamilyId: "fixture-family", scopes: ["dkg:read"], resource: `${base}/mcp`, expiresAt: Date.now() + 3600000 });
    const writerFile = path.join(directory, "writer-codes.json");
    fs.writeFileSync(writerFile, JSON.stringify({ unused: [{ code: writerCode }], used: [] }));
    const tokenFile = path.join(directory, "node.token");
    fs.writeFileSync(tokenFile, "synthetic-node-token");
    const environment = { PATH: process.env.PATH, DKG_API_URL: backendUrl, DKG_API_TOKEN: "synthetic-node-token", DKG_API_TOKEN_FILE: tokenFile,
      DKG_MCP_HOST: "127.0.0.1", DKG_MCP_PORT: String(mcpPort), DKG_MCP_PUBLIC_URL: base, DKG_MCP_OAUTH_STORE: oauthFile,
      DKG_MCP_ACTIVITY_STORE: activityFile, DKG_MCP_WRITER_CODES: writerFile, DKG_MCP_POLICY_CURRENT: pin, TRAC_CURATOR_AUTOSTART: "0",
      WATCH_DB: watcherFile, WATCH_SEEN: path.join(directory, "seen.json"), WATCH_DETECTIONS: path.join(directory, "detections.jsonl"), WATCH_ENABLED: "0",
      TRAC_CURATOR_INTAKE: path.join(directory, "curator-intake.sqlite"), TRAC_CURATOR_REVIEW: reviewFile,
      SWARM_STORE: path.join(directory, "registry.json"), SWARM_ADMIN_TOKEN: "synthetic-admin", SWARM_WEBHOOK_HOST: "127.0.0.1" };
    const startChild = async (script, env, marker) => {
      const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      let output = "";
      child.stdout.on("data", data => { output += data.toString(); });
      child.stderr.on("data", data => { output += data.toString(); });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${output}`)), 10000);
        child.stdout.on("data", data => { if (data.toString().includes(marker)) { clearTimeout(timer); resolve(); } });
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); });
      });
    };
    await startChild("server.mjs", environment, "TRAC marketing DKG MCP");
    let collectorUrl;
    if (collector) {
      const collectorPort = await unusedPort();
      collectorUrl = `http://127.0.0.1:${collectorPort}`;
      await startChild("collector/server.mjs", { ...environment, SWARM_WEBHOOK_PORT: String(collectorPort) }, "swarm webhooks http");
    }
    const webApp = express();
    webApp.use(express.json());
    webApp.post("/__fixture/unavailable", (req, res) => { unavailable = req.body.value === true; res.json({ ok: true }); });
    webApp.post("/__fixture/delay", (req, res) => {
      delays.clear();
      if (req.body.term) delays.set(req.body.term, Math.min(1000, Number(req.body.ms) || 0));
      res.json({ ok: true });
    });
    webApp.use("/api", async (req, res) => {
      try {
        const response = await fetch(`${base}/api${req.url}`);
        res.status(response.status).type("application/json").send(await response.text());
      } catch { res.status(503).json({ error: "fixture proxy unavailable" }); }
    });
    webApp.get("/memory", (_req, res) => res.sendFile(path.join(root, "site/memory.html")));
    webApp.use(express.static(path.join(root, "site")));
    const web = http.createServer(webApp);
    const webUrl = await listen(web, port ? port + 1 : 0);
    servers.push(web);
    return { base, webUrl, collectorUrl, readerToken, writerCode, activityFile, directory, shared, working, requests,
      setUnavailable(value) { unavailable = value; }, close };
  } catch (error) { await close(); throw error; }
}
