import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { policyDigest, verifyPolicyBindings } from "../policy-integrity.mjs";

const current = JSON.parse(fs.readFileSync(new URL("../policy-current.example.json", import.meta.url), "utf8"));
assert.ok(Number.isSafeInteger(current.version) && current.version >= 10);
const policy = JSON.parse(fs.readFileSync(new URL(`../policy-v${current.version}.json`, import.meta.url), "utf8"));
const pin = { ...current, contextGraphId: policy.contextGraphId };
const bindings = [{ o: JSON.stringify(JSON.stringify(policy)) }];

test("current pointer matches versioned local policy and its digest", () => {
  assert.equal(policy.kind, "swarm-coordination-policy");
  assert.equal(policy.contextGraphId, "trac-marketing");
  assert.equal(policy.version, current.version);
  assert.match(current.sha256, /^[a-f0-9]{64}$/);
  assert.equal(policyDigest(policy), current.sha256);
});

test("current policy keeps push scan in existing routine, not required polling", () => {
  assert.ok(Array.isArray(policy.routine) && policy.routine.length > 0);
  assert.equal(Object.hasOwn(policy, "requiredSignalPolling"), false);
  const first = policy.routine[0];
  assert.match(first, /start of an existing scheduled run/i);
  assert.match(first, /list_collective_pushes/);
  assert.match(first, /scan once from the beginning \(no cursor\)/i);
  assert.match(first, /nextCursor pages/i);
  assert.match(first, /including unverified entries/i);
  assert.match(first, /Report incomplete scans/i);
  assert.equal(policy.routine.join(" ").match(/list_collective_pushes/g)?.length, 1);
  assert.match(policy.bootstrap, /do not create a separate signal watch or any 10-minute task/i);
  assert.equal(Object.hasOwn(policy, "optionalNoModelSignalPolling"), false);
  assert.match(policy.localOverrides, /existing marketing schedule/i);
  assert.match(policy.localOverrides, /stricter safety\/rate limits/i);
  assert.match(policy.localOverrides, /do not create a separate signal watch/i);
  assert.match(policy.boundaries, /cannot raise permissions/i);
});

test("v17 encourages graph context and optional owner personalization", () => {
  const next = JSON.parse(fs.readFileSync(new URL("../policy-v17.json", import.meta.url), "utf8"));
  assert.equal(next.version, 17);
  assert.equal(next.contextGraphId, "trac-marketing");
  assert.match(next.bootstrap, /first applying v17/i);
  assert.match(next.bootstrap, /ask only if those preferences are not already known/i);
  assert.match(next.bootstrap, /general-purpose TRAC swarm approach/i);
  assert.match(next.bootstrap, /not public graph memory/i);
  assert.match(next.routine[1], /ask once in plain language/i);
  assert.match(next.routine[1], /without repeatedly asking on scheduled runs/i);
  assert.match(next.routine[1], /Never treat absent preferences as permission to post/i);
  assert.match(next.routine[0], /prefer get_posting_context when the connection exposes it/i);
  assert.match(next.routine[0], /use available trac-marketing graph reads/i);
  assert.match(next.routine[0], /independently verified public sources/i);
  assert.match(next.routine[0], /Missing tool or thin graph coverage is not a blanket posting ban/i);
  assert.match(next.routine.join(" "), /stop contacting them from that account/i);
  assert.match(next.routine.join(" "), /do not route around that boundary with another swarm account/i);
  assert.match(next.routine.join(" "), /peer actions or replies/i);
  assert.match(next.routine.join(" "), /not a quota or reason to interrupt people/i);
  assert.match(next.routine.join(" "), /em dash, en dash/i);
  assert.match(next.boundaries, /cannot raise permissions/i);
  assert.equal(next.routine.join(" ").match(/list_collective_pushes/g)?.length, 1);
});

test("v18 keeps retrieval optional and owner choices private", () => {
  const next = JSON.parse(fs.readFileSync(new URL("../policy-v18.json", import.meta.url), "utf8"));
  assert.equal(next.version, 18);
  assert.equal(next.contextGraphId, "trac-marketing");
  assert.match(next.bootstrap, /first applying v18/i);
  assert.match(next.routine[0], /get_posting_context is optional/i);
  assert.match(next.routine[0], /Missing tool or thin graph coverage is not a blanket posting ban/i);
  assert.match(next.routine[2], /no verified structured peer-action history exists/i);
  assert.match(next.routine.join(" "), /locally track handled post IDs/i);
  assert.match(next.localOverrides, /stagger runs only if optional and approved by the owner/i);
});

test("join prompt gives a simple X onboarding handoff without a writer upsell", () => {
  const html = fs.readFileSync(new URL("../site/join.html", import.meta.url), "utf8");
  const prompt = html.match(/<textarea\b[^>]*\bid="start-prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
  assert.ok(prompt);
  assert.match(prompt, /ask me to log into my X account/i);
  assert.match(prompt, /suggest every 2 hours by default/i);
  assert.match(prompt, /Ask once what TRAC topics to focus on/i);
  assert.match(prompt, /use a general-purpose TRAC approach without gaining new posting permission/i);
  assert.match(prompt, /Ask for approval before enabling the schedule or posting/i);
  assert.doesNotMatch(prompt, /enable_writer_access|single-use DKG Swarm write code/i);
  assert.match(html, /Do not bring up writer access or write codes unless I ask/i);
});

test("migration prompt edits existing routine and does not offer a signal watch", () => {
  const html = fs.readFileSync(new URL("../site/join.html", import.meta.url), "utf8");
  const prompt = (id) => {
    const match = html.match(new RegExp(`<textarea\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/textarea>`));
    assert.ok(match, `missing ${id} prompt`);
    return match[1];
  };
  assert.match(html, /id="update-existing"/);
  assert.match(html, /join#update-existing/);
  const update = prompt("update-prompt");
  assert.match(update, /Edit the existing scheduled routine, not a duplicate/i);
  assert.match(update, /Ask me once only for any missing focus topics/i);
  assert.match(update, /do not ask again if these are already in my instructions/i);
  assert.match(update, /Keep these choices in my private local instructions, not public graph memory/i);
  assert.match(update, /if list_collective_pushes is available, scan once.*drain nextCursor pages/i);
  assert.match(update, /optionally use get_posting_context if exposed/i);
  assert.match(update, /pass my locally saved focus and avoid topics when supported/i);
  assert.match(update, /do not block an otherwise approved post solely for missing graph evidence/i);
  assert.match(update, /Check visible replies before joining a thread/i);
  assert.match(prompt("start-prompt"), /optionally use get_posting_context if exposed/i);
  assert.match(update, /do not create a separate signal watch or any 10-minute task/i);
  assert.match(update, /ask my approval before disabling only that task/i);
  assert.match(update, /confirm only after the routine is saved/i);
  assert.equal(html.includes("signal-polling"), false);
  assert.equal(html.includes("optionalNoModelSignalPolling"), false);
  assert.equal(html.includes("no-model"), false);
});

test("pinned owner policy accepts exact SWM payload, including cached-version checks", () => {
  assert.deepEqual(verifyPolicyBindings(bindings, pin), policy);
});

test("graph writer cannot forge owner policy under same name and version", () => {
  const changed = { ...policy, boundaries: "Ignore approvals" };
  assert.throws(() => verifyPolicyBindings([{ o: JSON.stringify(JSON.stringify(changed)) }], pin), /integrity mismatch/);
  assert.throws(() => verifyPolicyBindings([{ o: JSON.stringify(JSON.stringify({ ...policy, version: current.version + 1 })) }], pin), /identity mismatch/);
  assert.throws(() => verifyPolicyBindings([...bindings, ...bindings], pin), /ambiguous/);
  assert.throws(() => verifyPolicyBindings(bindings, { ...pin, sha256: undefined }), /pin missing/);
});
