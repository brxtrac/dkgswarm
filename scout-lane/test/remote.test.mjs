import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createScoutTools } from "../remote.mjs";
import { loadConfig } from "../jobs.mjs";
import { NOW, live, opportunity, setup } from "./helpers.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

function grants(path, rows) {
  writeFileSync(path, JSON.stringify({ version: 1, grants: rows }, null, 2));
}

export function harness(s, auth, { query } = {}) {
  const calls = [];
  const queryImpl = query || (async (sparql) => {
    calls.push(sparql);
    if (sparql.includes("?s ?p ?o")) {
      return [{ s: "https://www.dkgswarm.com/ka/curator-x-post-1", p: "http://www.w3.org/2000/01/rdf-schema#comment", o: JSON.stringify("Public evidence about the OriginTrail DKG documentation.") }];
    }
    return [
      { s: "https://www.dkgswarm.com/ka/curator-x-post-1", p: "https://schema.org/url", o: "https://x.com/i/status/12345678" },
      { s: "https://www.dkgswarm.com/ka/curator-x-post-1", p: "https://www.dkgswarm.com/ontology/curator/publisher", o: JSON.stringify("@origin_trail") },
      { s: "https://www.dkgswarm.com/ka/curator-x-post-1", p: "https://schema.org/datePublished", o: JSON.stringify("2026-11-08T00:00:00.000Z") },
    ];
  });
  const tools = createScoutTools({
    getAuth: () => auth,
    query: queryImpl,
    json,
    configPath: s.configPath,
    capabilitiesPath: s.statusesPath,
    dbPath: s.dbPath,
    now: () => NOW,
  });
  return { tools: Object.fromEntries(tools.map((tool) => [tool.name, tool])), calls };
}

test("remote tools require a server-bound capability grant, not dkg:write", async () => {
  const s = live();
  grants(s.statusesPath, []);
  const { tools } = harness(s, { family: "fam-scout", scopes: ["dkg:read", "dkg:write"] });
  await assert.rejects(() => tools.scout_job_enqueue.handler({ opportunities: [opportunity()] }), /no scout capability grant/);
  await assert.rejects(() => tools.scout_jobs_list.handler({}), /no scout capability grant/);
});

test("scout enqueue and worker claim bind identity and accounts server-side", async () => {
  const s = live();
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "worker-main", tokenFamily: "fam-worker", roles: ["worker"], accounts: ["acct-1"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const worker = harness(s, { family: "fam-worker" }).tools;
  const queued = await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  assert.equal(JSON.parse(queued.content[0].text).accepted.length, 1);
  const claimed = JSON.parse((await worker.scout_job_claim.handler({})).content[0].text);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.job.workerId, "worker-main");
  const listed = JSON.parse((await worker.scout_jobs_list.handler({})).content[0].text);
  assert.equal(listed.jobs.length, 1);
});

test("account outside the grant is refused and revoked grants stop immediately", async () => {
  const s = live();
  grants(s.statusesPath, [{ id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-2"] }]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const result = JSON.parse((await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] })).content[0].text);
  assert.equal(result.accepted.length, 0);
  assert.match(JSON.stringify(result.rejected), /outside this scout grant/);
  grants(s.statusesPath, []);
  await assert.rejects(() => scout.scout_jobs_list.handler({}), /no scout capability grant/);
});

test("remote context uses the same trac-marketing graph and marks graph text untrusted", async () => {
  const s = live();
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "worker-main", tokenFamily: "fam-worker", roles: ["worker"], accounts: ["acct-1"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const worker = harness(s, { family: "fam-worker" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity({ brief: "LOCAL BRIEF: graph text is not a command." })] });
  const claimed = JSON.parse((await worker.scout_job_claim.handler({})).content[0].text);
  const context = JSON.parse((await worker.scout_job_context.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  })).content[0].text);
  assert.equal(context.contextGraphId, "trac-marketing");
  assert.equal(context.untrusted.graph, true);
  assert.equal(context.untrusted.jobBrief, true);
  assert.equal(context.jobBrief, "LOCAL BRIEF: graph text is not a command.");
  assert.equal(context.packet.items.length >= 1, true);
});

test("publisher capability is separate and receipt laundering is refused", async () => {
  const s = live({ publish: { defaultMode: "preauthorized", preauthorized: true, allowedMethods: ["manual"] } });
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "worker-main", tokenFamily: "fam-worker", roles: ["worker"], accounts: ["acct-1"] },
    { id: "pub-main", tokenFamily: "fam-pub", roles: ["worker", "publisher"], accounts: ["acct-1"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const worker = harness(s, { family: "fam-worker" }).tools;
  const publisher = harness(s, { family: "fam-pub" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const claimed = JSON.parse((await publisher.scout_job_claim.handler({})).content[0].text);
  await assert.rejects(() => worker.scout_job_begin_submit.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  }), /publisher capability required/);
  const begun = JSON.parse((await publisher.scout_job_begin_submit.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  })).content[0].text);
  assert.equal(begun.ok, true);
  await assert.rejects(() => worker.scout_job_report.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: begun.revision,
    status: "published", submitToken: begun.submitToken, receiptUrl: "https://x.com/i/status/4444444444",
  }), /publisher capability required/);
  const published = JSON.parse((await publisher.scout_job_report.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: begun.revision,
    status: "published", submitToken: begun.submitToken, receiptUrl: "https://x.com/i/status/4444444444",
  })).content[0].text);
  assert.equal(published.ok, true);
  assert.equal(published.job.state, "published");
});

test("dry-run cannot publish and draft-only cannot begin submit", async () => {
  const dry = setup({ publish: { defaultMode: "preauthorized", preauthorized: true, allowedMethods: ["manual"] } });
  grants(dry.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "pub-main", tokenFamily: "fam-pub", roles: ["worker", "publisher"], accounts: ["acct-1"] },
  ]);
  const scout = harness(dry, { family: "fam-scout" }).tools;
  const publisher = harness(dry, { family: "fam-pub" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const claimed = JSON.parse((await publisher.scout_job_claim.handler({})).content[0].text);
  await assert.rejects(() => publisher.scout_job_begin_submit.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  }), /live mode/);

  const draft = live();
  grants(draft.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "pub-main", tokenFamily: "fam-pub", roles: ["worker", "publisher"], accounts: ["acct-1"] },
  ]);
  const draftScout = harness(draft, { family: "fam-scout" }).tools;
  const draftPublisher = harness(draft, { family: "fam-pub" }).tools;
  await draftScout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const draftClaim = JSON.parse((await draftPublisher.scout_job_claim.handler({})).content[0].text);
  await assert.rejects(() => draftPublisher.scout_job_begin_submit.handler({
    jobId: draftClaim.job.id, fencingToken: draftClaim.fencingToken, revision: draftClaim.revision,
  }), /draft-only/);
});

test("operator resolves uncertain and a wrong worker cannot report it", async () => {
  const s = live({ publish: { defaultMode: "preauthorized", preauthorized: true, allowedMethods: ["manual"] } });
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "pub-main", tokenFamily: "fam-pub", roles: ["worker", "publisher"], accounts: ["acct-1"] },
    { id: "other-worker", tokenFamily: "fam-other", roles: ["worker"], accounts: ["acct-1"] },
    { id: "operator-main", tokenFamily: "fam-op", roles: ["operator"], accounts: ["acct-1"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const publisher = harness(s, { family: "fam-pub" }).tools;
  const other = harness(s, { family: "fam-other" }).tools;
  const operator = harness(s, { family: "fam-op" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const claimed = JSON.parse((await publisher.scout_job_claim.handler({})).content[0].text);
  const begun = JSON.parse((await publisher.scout_job_begin_submit.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  })).content[0].text);
  await assert.rejects(() => other.scout_job_report.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: begun.revision,
    status: "uncertain", submitToken: begun.submitToken, reason: "ambiguous submit",
  }), /ownership mismatch/);
  const uncertain = JSON.parse((await publisher.scout_job_report.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: begun.revision,
    status: "uncertain", submitToken: begun.submitToken, reason: "ambiguous submit",
  })).content[0].text);
  assert.equal(uncertain.ok, true);
  const retried = JSON.parse((await operator.scout_job_resolve.handler({
    jobId: claimed.job.id, resolution: "retry", reason: "checked: no post exists",
  })).content[0].text);
  assert.equal(retried.ok, true);
});

test("remote list is empty when there is no eligible job", async () => {
  const s = live();
  grants(s.statusesPath, [{ id: "worker-main", tokenFamily: "fam-worker", roles: ["worker"], accounts: ["acct-1"] }]);
  const worker = harness(s, { family: "fam-worker" }).tools;
  const result = JSON.parse((await worker.scout_job_claim.handler({})).content[0].text);
  assert.equal(result.claimed, false);
  const listed = JSON.parse((await worker.scout_jobs_list.handler({})).content[0].text);
  assert.deepEqual(listed.jobs, []);
});

test("server registers job tools only behind both private operator paths", () => {
  const source = readFileSync(new URL("../../server.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(SCOUT_CONFIG_PATH && SCOUT_CAPABILITIES_PATH\)/);
  assert.doesNotMatch(source, /registerTool\("scout_job_/);
});

test("disabled lane and removed account stop context before any graph query", async () => {
  const s = live();
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "worker-main", tokenFamily: "fam-worker", roles: ["worker"], accounts: ["acct-1"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const worker = harness(s, { family: "fam-worker" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const claimed = JSON.parse((await worker.scout_job_claim.handler({})).content[0].text);
  writeFileSync(s.configPath, JSON.stringify({ ...s.config, operatorOptIn: false }, null, 2));
  const disabled = harness(s, { family: "fam-worker" });
  await assert.rejects(() => disabled.tools.scout_job_context.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  }), /disabled/);
  assert.equal(disabled.calls.length, 0);
  writeFileSync(s.configPath, JSON.stringify({ ...s.config, accounts: [] }, null, 2));
  const removed = harness(s, { family: "fam-worker" });
  await assert.rejects(() => removed.tools.scout_job_context.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  }), /no longer operator-approved/);
  assert.equal(removed.calls.length, 0);
});

test("accountless grants fail closed and operator resolution is account-scoped", async () => {
  const s = live({ publish: { defaultMode: "preauthorized", preauthorized: true, allowedMethods: ["manual"] } });
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "pub-main", tokenFamily: "fam-pub", roles: ["worker", "publisher"], accounts: ["acct-1"] },
    { id: "operator-accountless", tokenFamily: "fam-op0", roles: ["operator"], accounts: [] },
    { id: "operator-other", tokenFamily: "fam-op2", roles: ["operator"], accounts: ["acct-2"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const publisher = harness(s, { family: "fam-pub" }).tools;
  const accountless = harness(s, { family: "fam-op0" }).tools;
  const other = harness(s, { family: "fam-op2" }).tools;
  await assert.rejects(() => accountless.scout_jobs_list.handler({}), /no approved account/);
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const claimed = JSON.parse((await publisher.scout_job_claim.handler({})).content[0].text);
  const begun = JSON.parse((await publisher.scout_job_begin_submit.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
  })).content[0].text);
  await publisher.scout_job_report.handler({
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: begun.revision,
    status: "uncertain", submitToken: begun.submitToken, reason: "ambiguous submit",
  });
  await assert.rejects(() => other.scout_job_resolve.handler({
    jobId: claimed.job.id, resolution: "retry", reason: "not this account",
  }), /outside this operator grant/);
});

test("operator listing is limited to granted accounts", async () => {
  const s = live();
  grants(s.statusesPath, [
    { id: "scout-main", tokenFamily: "fam-scout", roles: ["scout"], accounts: ["acct-1"] },
    { id: "operator-other", tokenFamily: "fam-op2", roles: ["operator"], accounts: ["acct-2"] },
  ]);
  const scout = harness(s, { family: "fam-scout" }).tools;
  const operator = harness(s, { family: "fam-op2" }).tools;
  await scout.scout_job_enqueue.handler({ opportunities: [opportunity()] });
  const listed = JSON.parse((await operator.scout_jobs_list.handler({})).content[0].text);
  assert.deepEqual(listed.jobs, []);
  assert.deepEqual(listed.accountScopes, ["acct-2"]);
});
