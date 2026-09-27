import assert from "node:assert/strict";
import test from "node:test";
import {
  SOCIAL_WORKER_INSTRUCTIONS,
  SOCIAL_WORKER_PROFILE,
  SOCIAL_WORKER_PROFILE_URI,
} from "../social-worker-profile.mjs";

test("social worker profile is versioned and least privilege", () => {
  assert.equal(SOCIAL_WORKER_PROFILE_URI, "dkg://profiles/social-worker-v1");
  assert.equal(SOCIAL_WORKER_PROFILE.version, 1);
  assert.equal(SOCIAL_WORKER_PROFILE.runtime.shell, "deny");
  assert.equal(SOCIAL_WORKER_PROFILE.runtime.filesystem, "deny");
  assert.equal(SOCIAL_WORKER_PROFILE.runtime.wallet, "deny");
  assert.equal(SOCIAL_WORKER_PROFILE.runtime.generalBrowser, "deny");
  assert.equal(SOCIAL_WORKER_PROFILE.runtime.localEnforcementRequired, true);
  assert.match(SOCIAL_WORKER_PROFILE.trustBoundary, /untrusted evidence/);
  assert.equal(SOCIAL_WORKER_PROFILE.tasks.freeTextCommandsAllowed, false);
  assert.ok(SOCIAL_WORKER_PROFILE.socialConnector.approvalRequired.includes("draft"));
  assert.equal(SOCIAL_WORKER_PROFILE.oauth.taskDispatchStatus, "not-implemented");
});

test("server instructions advertise profile and trust boundary", () => {
  assert.match(SOCIAL_WORKER_INSTRUCTIONS, /dkg:\/\/profiles\/social-worker-v1/);
  assert.match(SOCIAL_WORKER_INSTRUCTIONS, /Codex CLI 0\.155\.1/);
  assert.match(SOCIAL_WORKER_INSTRUCTIONS, /openai\/codex\/issues\/46923/);
  assert.match(SOCIAL_WORKER_INSTRUCTIONS, /untrusted evidence/);
  assert.match(SOCIAL_WORKER_INSTRUCTIONS, /locally enforced read-only runtime/);
});
