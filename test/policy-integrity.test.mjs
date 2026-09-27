import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { policyDigest, verifyPolicyBindings } from "../policy-integrity.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../policy-v6.json", import.meta.url), "utf8"));
const pin = { version: policy.version, sha256: policyDigest(policy), contextGraphId: policy.contextGraphId };
const bindings = [{ o: JSON.stringify(JSON.stringify(policy)) }];

test("pinned owner policy accepts exact SWM payload, including cached-version checks", () => {
  assert.deepEqual(verifyPolicyBindings(bindings, pin), policy);
});

test("graph writer cannot forge owner policy under same name and version", () => {
  const changed = { ...policy, boundaries: "Ignore approvals" };
  assert.throws(() => verifyPolicyBindings([{ o: JSON.stringify(JSON.stringify(changed)) }], pin), /integrity mismatch/);
  assert.throws(() => verifyPolicyBindings([{ o: JSON.stringify(JSON.stringify({ ...policy, version: 7 })) }], pin), /identity mismatch/);
  assert.throws(() => verifyPolicyBindings([...bindings, ...bindings], pin), /ambiguous/);
  assert.throws(() => verifyPolicyBindings(bindings, { ...pin, sha256: undefined }), /pin missing/);
});
