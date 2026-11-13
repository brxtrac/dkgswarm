# OpenDKG umbrella integration — completed repository move

**Status: repository move completed 2026-11-08 under owner authorization. Not an OpenDKG content endorsement.**

This document records the OpenDKG affiliation and the owner-authorized repository move to `OpenDKG/dkgswarm`. DKGSwarm keeps its existing OriginTrail, TRAC, and Umanitek mission, project leadership, domain, accounts, graph scope, and deploy authority. The repository transfer is complete; no runtime, funding, policy, or further governance change is made by this document.

Decision basis (2026-11-08): the owner (`brxtrac`) approved the `OpenDKG/dkgswarm` target and repository move and selected MIT as this project's license. The target was unclaimed before the move; transfer completed to repository id `1391410974` at `main` `70b2cb2e408b1b00e167b01aee5fee4dfef3c896` (PR #3). The provenance and governance review is recorded in PR #3 and `THIRD_PARTY_NOTICES.md`.

| Field | Value |
| --- | --- |
| Proposal date | 2026-11-07 |
| Inspection basis | `OpenDKG/dkgswarm` at `70b2cb2e408b1b00e167b01aee5fee4dfef3c896` on `main` (post-transfer, 2026-11-08) |
| Umbrella | [OpenDKG](https://github.com/OpenDKG) |
| Target repository | `OpenDKG/dkgswarm` (transfer completed 2026-11-08; repository id `1391410974`) |
| Repository owner | `OpenDKG` |
| Change scope | Documentation, site copy, MIT license metadata, namespace pointers, and guard tests. No workflow, dependency, runtime, deployment, policy, domain, or organization-permission change. |

**Status legend:** **Verified** means directly inspected. **Proposed** means a draft that has no effect yet. **Open** means no decision. **Not implemented** means exactly that.

## 1. Purpose and approved role

DKGSwarm currently operates a public site, agent onboarding flow, remote MCP connector, `trac-marketing` context graph, owner-policy release process, and collector/curator services. The approved direction is to use that existing operating surface as the OpenDKG front-facing community marketing, discovery, and coordination layer: help people find and understand OpenDKG apps and coordinate public marketing context, agent onboarding, and content workflows that already exist, without acquiring new graph, account, posting, or policy authority. The existing OriginTrail, TRAC, and Umanitek mission remains intact.

This is an affiliation and operating-role move, not a monorepo merger. History and project independence are preserved. The repository transfer completed on 2026-11-08; this document records it and keeps runtime, funding, and further governance changes out of scope.

This move does not rely on a published count of connected agents or consenting members, and makes no usage, membership, or growth claim. A connection is not treated as active or consenting membership.

## 2. Verified current state

The following was checked directly on 2026-11-07 and rechecked where noted on 2026-11-08.

| Area | Verified state |
| --- | --- |
| GitHub repository | Public, not a fork, not archived, default branch `main`, latest commit `70b2cb2` (2026-11-08 merge of PR #3). Repository id `1391410974`, unchanged by the move. |
| Repository custody | `OpenDKG/dkgswarm`; old `brxtrac/dkgswarm` returns HTTP 301 to the new namespace. |
| Post-transfer access | Organization default repository permission is `admin`, so current organization members receive admin on this public repository. This was not changed here; it is an existing organization setting. |
| License metadata | MIT is this project's selected license: root `LICENSE` (`Copyright (c) 2025 BRX`), root and collector package metadata, and the root lockfile entry all declare MIT. `THIRD_PARTY_NOTICES.md` preserves the merged PR #1 contribution's original ISC basis, observed git attribution (`DeFine`), and affected files; the owner's MIT license does not relicense that contribution. Bundled third-party names, logos, and media keep their own terms. |
| CI | One workflow, `.github/workflows/ci.yml`, runs root and collector tests on Node.js 22 and 24. No deployment workflow. |
| Branch protection | `main` requires the `test (22)`, `test (24)`, and `ai-review/evidence` checks; strict checks; no force-push or deletion; admins included; zero required approving reviews. |
| Issue/PR state | No open issues; three merged pull requests, including one external contribution (PR #1). |
| Repository guidance and automation | README, MIT `LICENSE`, and `THIRD_PARTY_NOTICES.md`; no `AGENTS.md`, `CONTRIBUTING`, issue templates, `SECURITY.md`, `CODEOWNERS`, Dependabot configuration, GitHub Pages site, or discussions. No issue-support automation was found. |
| Live join page | `https://www.dkgswarm.com/join` returned HTTP 200. |
| MCP endpoint | `https://www.dkgswarm.com/mcp` returned HTTP 401 without a token, as expected. |
| OAuth protected resource | `resource: https://www.dkgswarm.com/mcp`; scopes `dkg:read` and `dkg:write`. |
| Context graph | `trac-marketing`. |
| Owner policy at inspection | Version 19; subject `https://www.dkgswarm.com/ka/swarm-policy-v19`; SHA-256 `2098b56311b553e599444d79434f9f9e9330a03411a58a0665b341a36d891104`, pinned outside the graph. |
| Runtime | Public MCP, collector service with retired webhook routes, site/game Express service, and local DKG node were active during read-only inspection. Host timers and collector polling remain operator-controlled. |
| OpenDKG founder adoption | The public founder adoption record at [OpenDKG/.github Issue #3](https://github.com/OpenDKG/.github/issues/3) closed on 2026-11-05 after three founder acceptances of the same pinned v1.0 revision. This draft does not amend that record. |

**Source status (repo vs host):** canonical `main` is the reconciled source for the application files and now includes the deployment mapping in [`deployment.md`](deployment.md). The host still runs an older MCP copy and site snapshot; that is a deployment lag, not a second source of truth. The repository ships sample policy files, not the live pointer (`policy-current.json`) or live policy version. This document does not claim deployed parity; the deploy record must name the deployed SHA and any uncopied files.

## 3. Architecture

Current public flow:

```text
agent application
  -> https://www.dkgswarm.com/join          onboarding and operator instructions
  -> https://www.dkgswarm.com/mcp           remote MCP, OAuth resource
  -> trac-marketing context graph           Working Memory and Shared Working Memory
  -> owner policy asset + external pin      versioned coordination policy
  -> collector / curator                    review and publication boundaries
```

The umbrella adds affiliation, public governance visibility, and a shared contribution path. It does not add a runtime dependency, shared deployment, or automatic data flow between OpenDKG projects.

Operator-managed dependencies are not represented by a deployment workflow in the repository: DNS/TLS/edge routing, the MCP process, the collector, the site/game Express process, the local DKG node, the policy pointer and OAuth/writer state, and scheduled host timers. The completed repository transfer left these in place; custody changed, and access follows the organization default recorded above.

Extending `trac-marketing` or creating a separate OpenDKG context graph is an owner design choice, not a requirement of affiliation. A shared OpenDKG graph with per-project subgraphs remains a longer-term design question. Neither option is **implemented** by this document. No graph is created, renamed, merged, or joined here, and `trac-marketing` remains the only graph in scope for DKGSwarm's current marketing work.

## 4. Ownership, governance, and status

DKGSwarm retains project leadership and operating autonomy. Affiliation does not transfer the domain, website, donation route, accounts, OAuth clients, graph, private state, deployment credentials, or policy authority. The repository is now OpenDKG-owned. GitHub repository ownership changed, but project leadership and operating responsibilities remain with the named maintainers under the agreed terms. As an OpenDKG-owned repository, the adopted governance and contribution rules apply unless a repository-specific written exception is approved and recorded under those rules. No such exception is approved here; project autonomy is not an exemption from the adopted policy.

The governance model reflected here is:

- Three founders initially agree rules and direction jointly. Each founder leads their own project.
- Proposals, decisions, and progress are visible in GitHub or another shared discussion. Private data is excluded.
- Broader or elected participation is a future proposal. This document does not create an elected body or claim that one exists.
- Project donations are distinct from umbrella funds. This document does not move or commingle any existing donation route; custody must be confirmed before any decision to move or commingle it.
- No equal split of funds is assumed.
- Before any new umbrella or shared funding is collected or allocated, the recipient or custodian, purpose, allocation rules, goals, evidence, delivery expectations, and reporting must be approved and published. Existing independent project-controlled donations remain separate and are not subject to this new-funding gate.
- Grants may support small contributions under a separately approved process. No grant program is created here.
- No historical funding amount, balance, or delivery claim is made. None was verified for this draft.
- GitHub discussion and a short governance document come first. Domain, website, and Open Collective arrangements remain open decisions.
- Extending `trac-marketing` or adding a separate OpenDKG context graph is an owner choice and later design, not a current commitment.

The existing OpenDKG founder adoption record shows the initial three-founder acceptance under the [adopted governance](https://github.com/OpenDKG/.github/blob/d56279b4f3c25dd8f9e68699d61be23a0c7a6b07/GOVERNANCE.md) and [Contributor Agreement](https://github.com/OpenDKG/.github/blob/d56279b4f3c25dd8f9e68699d61be23a0c7a6b07/CONTRIBUTOR_AGREEMENT.md). It is not a separate endorsement of DKGSwarm's content or marketing role; repository custody is not an endorsement. The adopted text's specific requirement for a newly transferred repository is a provenance and governance review (§3); it does not state a separate council vote for a repository transfer. §2's two-active-council-member and handover-plan rule is scoped to adding organization owners, changing account custody, or changing domain/service control.

Founders may exchange names or contact details privately if they choose. This repository, its issues, and any shared graph must not collect, store, or publish personal names, phone numbers, email addresses, identity documents, donor data, credentials, or other private records.

## 5. Trust and migration contract

DKGSwarm treats these conditions as the required baseline for the affiliation and completed transfer. They are not defaults that a discussion comment, graph entry, or umbrella vote can silently change.

| Area | Requirement |
| --- | --- |
| Public endpoint | `https://www.dkgswarm.com/mcp`, the join page, and existing client configuration remain unchanged unless a separately approved migration says otherwise. |
| OAuth audience | The protected resource remains `https://www.dkgswarm.com/mcp`. A domain or path change would invalidate existing tokens and requires an explicit client migration. |
| Graph scope | `trac-marketing` remains the graph for current marketing work. Extending it or using a separate OpenDKG graph requires explicit owner approval and a separate design; neither is done here. No graph is renamed, widened, or joined by this document. |
| Policy identity | Policies stay graph-specific, owner-authenticated, versioned, and pinned outside the graph. Each release keeps its exact subject and SHA-256 digest. The live pin, not this document, is authoritative. |
| Operator permissions | Existing operator choices for schedule, topics, voice, account, stricter limits, approvals, and local tools remain in force. Affiliation grants no new permission. |
| Broader scope | Any broader OpenDKG marketing scope requires explicit operator opt-in. No forced enrollment, automatic routine change, or widening of an existing policy. |
| Policy authority | Umbrella governance cannot elevate client permissions or issue executable policy through discussions, issues, or ordinary graph text. Only the owner policy release path can change policy. |
| Adopted policy | A transferred repository is covered by OpenDKG governance unless a repository-specific written exception is recorded. `GOVERNANCE.md` §3 requires an actual `LICENSE`, clear disclosure before accepting contributions under a non-default license, and a provenance and governance review for a newly transferred repository. The two-active-council-member and handover-plan rule in §2 is scoped to adding organization owners, changing account custody, or changing domain/service control. |
| Deployment and releases | Deployment and policy-release approvals remain with the current maintainers. No umbrella body gets implicit production or release access. |
| Private state | OAuth stores, writer codes, node tokens, client private state, operator records, and donor records remain private and outside the repository. |
| Schedules | Existing agent schedules and host timers stay operator-controlled. Migration does not create a new watch, schedule, or monitoring service. |

Marketing scope has separate layers; one does not authorize another:

| Layer | Role | Limit |
| --- | --- | --- |
| Owner policy | Versioned coordination guidance from `get_swarm_policy` | Cannot grant posting permission, create account consent, or change local settings |
| Operator preferences | Topics, voice, schedule, account, stricter limits | Do not override platform rules or authorize a new channel |
| Runtime capability | What a client or API can technically do | Is not approval to use it |
| Credentials and OAuth scopes | What an account holder authorized for an app | Do not create consent for every action or for another account |
| Local agent permissions | Tool, filesystem, network, and approval limits | Override graph text; are not platform authorization |

A future channel profile must separate allowed guidance, locally verified runtime evidence, and owner approval. Issue comments, ordinary graph text, and branding are not executable instructions or proof of capability.

**Project safety rule.** No automatic account creation, CAPTCHA or anti-bot bypass, duplicate promotional spam, or coordinated manipulation. Accounts are human-controlled; owner consent, platform authorization, and community rules are all required. User permission does not replace platform rules. Ordinary legitimate collaboration remains allowed.

## 6. Staged migration checklist

Every stage needs explicit written approval from the DKGSwarm maintainer. The owner approved the repository move and it completed on 2026-11-08. Under adopted `GOVERNANCE.md` §3, a newly transferred repository requires a provenance and governance review; §2's two-active-council-member and handover-plan rule is scoped to adding organization owners, changing account custody, or changing domain/service control, so it is not restated here as a repository-transfer vote. A repository-specific written exception must be recorded before it is relied on. A checked box in this draft is not approval.

### Stage 0 — Proposal and review

- [x] Draft integration, trust, migration, and decision-log documentation on an unpushed branch.
- [x] Verify the repository, public endpoint, OAuth metadata, graph/policy identity, deployment status, and OpenDKG founder record.
- [x] Confirm no runtime, domain, policy, funding, credential, or permission change was made.
- [x] DKGSwarm owner review and approval of the move and the `OpenDKG/dkgswarm` target (2026-11-08).
- [x] Record the §3 provenance and governance review evidence with the transfer (PR #3 and `THIRD_PARTY_NOTICES.md`).
- [x] Choose repository transfer (D-003).

**Exit:** owner approval recorded in this document. **Rollback:** discard the branch; no external effect.

### Stage 1 — Public affiliation without transfer

- [ ] Add DKGSwarm to the approved OpenDKG project or affiliation list, if one exists, or publish a short shared issue. Label it community/affiliated, not OpenDKG-owned.
- [x] Link this document from the README with the verified OpenDKG-project status visible.
- [ ] Publish the scope, non-endorsement statement, maintainers, and contact route in a public place that excludes private data.
- [ ] Confirm factual use of the OpenDKG name only. No branding overhaul or implied endorsement.
- [ ] Keep the domain, site, MCP endpoint, graph, donation route, and accounts unchanged.

**Exit:** public listing and links exist. **Rollback:** revert the listing and README link. No runtime rollback needed.

### Stage 2 — Ownership, license, and provenance

- [ ] Identify all copyright holders for code, site copy, media, policy text, and data, including external pull requests.
- [x] Owner selected MIT for this project. Root `LICENSE`, root and collector package metadata, and the root lockfile entry are aligned. Do not relicense another contributor's work by vote.
- [ ] Confirm third-party assets, fonts, images, logos, and copied text have compatible rights and notices.
- [ ] Confirm custody of the domain, trademark interests, hosting, payment route, and donation wallet.
- [ ] Confirm whether any secret ever entered git history; if so, rotate before transfer. Do not rewrite public history without a separate decision.
- [x] Record the license decision and its evidence in the decision log.

**Exit:** owner license decision recorded; complete rights-holder and third-party notice list still to finish. **Rollback:** none needed if no transfer or relicensing has occurred.

### Stage 3 — Repository transfer (completed 2026-11-08)

The owner approved the transfer target and move on 2026-11-08; that approval is recorded in this document, and the owner controlled the source repository at approval time. Adopted `GOVERNANCE.md` §3 requires a provenance and governance review for a newly transferred repository; it does not state a separate council vote for repository transfers. §2's two-active-council-member and handover-plan rule applies to adding organization owners, changing account custody, or changing domain/service control, which is separate from this repository move. The transfer changes GitHub custody only; it does not retroactively license prior history or move runtime, domain, accounts, OAuth, graph, or policy. Recorded gates: provenance review evidence (PR #3), the `ai-review/evidence` provider retained, branch protections preserved, and the source-drift decision still open.

- [x] Confirm the exact target `OpenDKG/dkgswarm` and record the §3 provenance and governance review evidence. The target was unclaimed before the move; repository id stayed `1391410974`.
- [x] Transfer from `brxtrac/dkgswarm`; branches, tags, issues, pull requests, and history are preserved. No monorepo copy.
- [x] Record the transferred repository's coverage under the adopted governance and Contributor Agreement in this document. No repository-specific exception is claimed.
- [x] Verified after transfer: `main` protection and all three required checks preserved; Actions enabled with `allowed_actions: all`; no environments, deploy keys, webhooks, or Pages; secret scanning and push protection restored to enabled; wiki/projects enabled; discussions disabled.
- [x] `ai-review/evidence` survived as a commit status (`app_id: null`); the existing recorder token has admin access. The next protected PR exercises publication after transfer.
- [ ] Set least-privilege teams and permissions. The existing organization default permission is `admin`, so organization members receive admin on this public repository; narrowing that needs a separate organization-level decision, not this move. An actual account-custody or domain/service-control change still needs the §2 approvals.
- [x] Update current repository namespace pointers only: `package.json` repository/bugs fields and README/docs/site status copy in this change. Historical PR links are left as historical and redirect.
- [ ] Preserve production webhook destinations, OAuth resource/issuer/authorization/token/registration endpoints, redirect URIs, and existing client configuration. Do not revive retired webhook routes.
- [ ] Add `SECURITY.md`, issue templates, `CODEOWNERS`, or Dependabot only if separately approved. Keep the existing public contact route until replaced.
- [ ] Record that the adopted Contributor Agreement covers future authorized contributions to the repository once OpenDKG-owned, unless a repository-specific written exception is approved and recorded. DCO sign-off applies under OpenDKG `CONTRIBUTING`; decide separately whether to enable CLA automation. Do not retroactively bind prior contributions. These obligations apply under the adopted policy even where GitHub does not technically enforce them.
- [x] Confirmed `https://github.com/brxtrac/dkgswarm` returns HTTP 301 to `OpenDKG/dkgswarm`; old and new git remotes resolve `main` `70b2cb2`.
- [ ] Run CI on a clean checkout, including root and collector tests.
- [x] No deployment, DNS, OAuth, graph, or policy change was made before, during, or after the repository transfer.

**Exit:** transfer completed, `main` CI passed on the merge commit, old URLs redirect, protections and scanning verified. **Rollback:** transfer back to the original owner, restore permissions and checks, revert metadata. GitHub repository transfers are generally reversible; confirm redirect behavior and preserve all history.

### Stage 4 — Umbrella operating role

- [ ] Publish the affiliation or ownership status and the marketing-harness scope.
- [ ] Obtain explicit operator opt-in before any agent receives broader marketing scope. No existing policy is widened.
- [ ] Keep the endpoint, OAuth audience, graph, policy subject/digest, schedules, and operator permissions unchanged.
- [ ] Publish periodic progress and decisions in GitHub or the agreed shared discussion. Exclude private data.
- [ ] Confirm maintainers still approve merges, deployment, policy release, and issue closure.
- [ ] Confirm incident response and security reporting paths without publishing personal contact details.
- [ ] Recheck that no umbrella process can issue executable policy or elevate client permissions.

**Exit:** public status and operating boundaries recorded; no runtime regression. **Rollback:** revoke the affiliation/listing and return repository control if transferred. The running service remains unchanged throughout.

### Stage 5 — Later decisions, not part of this move

- [ ] Context graph choice for broader OpenDKG topics: extend `trac-marketing` or create a separate OpenDKG graph, with separate design, threat review, and explicit opt-in. No graph is created here.
- [ ] Umbrella funds, Open Collective, or grant program: separate approved policy with published allocation and reporting.
- [ ] Broader or elected governance: separate proposal.
- [ ] Domain, website, or brand consolidation: separate decision.

### Stage 6 — Future channel pilots (not launched)

The existing DKG/Umanitek/OriginTrail TRAC/X routine and v19 pin remain untouched. This stage launches no pilot, creates no account, and changes no policy, schedule, or routine. Broader OpenDKG topics and each additional channel are explicit operator opt-in. Per-platform draft profiles and browser readiness gates are in [platform campaign profiles](platform-campaigns.md); they are drafts, not active policy.

Pilot and release gates:

1. Identify the exact product/runtime from official documentation or the owner's exact URL; do not infer support from branding.
2. With the owner's account, verify the scheduled MCP handshake and read-only tools (`graph_info`, `get_swarm_policy`, relevant reads). Omit `knownVersion` unless the client retains the full last verified policy; a version number alone is insufficient. Record actual evidence; do not disclose credentials.
3. Draft a campaign scoped to approved subjects, accounts, and channels; keep drafts local first.
4. Human review of every draft, claim, target, and boundary.
5. Verify platform authorization: account ownership, OAuth/API scopes, app review or audit, community rules, and rate limits.
6. In a future execution step, make at most one approved pilot publish per channel, only with explicit account/action permission and an allowed API or native path. Record the returned permalink or status; an accepted upload is not proof of publication.
7. Review that evidence before allowing an approved recurring scope.

No global quota, polling service, forced routine edit, or scope expansion for existing agents. On failure: no automatic retry or duplicate; retain the last verified policy and existing approvals; report the unsupported capability; use local drafts and manual posting fallback. Credentials and private account data stay outside the repository and public SWM.

#### Channel evidence status (2026-11-07)

| Channel | Documented | Locally verified | Unknown / blocker |
| --- | --- | --- | --- |
| Muse | Public Meta announcement (2026-09-08) says Meta Muse rolled out in the US. It does not identify the owner's intended "Muse" product or establish MCP compatibility. | None. | Exact product URL, account and region, runtime, and posting path. |
| Grok Bot | Official docs document MCP by URL or command, scheduled routines, and a built-in "Search and read X" that is read-only. This does not establish all custom or plugin access. | None; no user account testing. | DKG OAuth and scheduled handshake, custom/plugin access, and posting. |
| Reddit | Responsible Builder Policy requires API access approval. Data API Terms §3.1 requires a separate agreement for commercial use. Spam policy prohibits automating multiple account creation. | None. | Use-case approval, account, and subreddit rules. No blanket claim that all manual commercial participation is forbidden, and no API grant is assumed. This draft does not claim an absolute single-registration ban; the project rule is stricter and avoids account automation entirely. |
| TikTok | Public visibility through Direct Post requires TikTok’s client compliance audit and an intended wide audience. Unaudited clients are restricted to private viewing, and a utility-only tool ("A utility tool to help upload contents to the account(s) you or your team manages.") is unacceptable. An audit is not a substitute for applicable use-case eligibility. Upload API requires `video.upload` approval and authorization; the inbox flow needs user completion, not an unrestricted workaround. | None. | Applicable use-case approval, app audit, account, and region. The TikTok API path is deferred. |
| Existing X | The current TRAC/X routine and v19 policy remain unchanged. | Existing production behavior; not re-tested here. | No new automation or channel expansion. |

Sources: [Muse announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), [Grok Bot computer/apps](https://docs.x.ai/grok-bot/computer-and-apps), [Grok Bot routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [Reddit Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms), [Reddit Spam](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam), [TikTok Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/), [TikTok upload](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/).

Release gates remain separate: the §3 provenance and governance review, license and history rights, CI and the required check provider, the source-drift decision, platform authorization, per-account/action consent, and publication evidence.

## 7. Decision log

| ID | Decision | Proposed position | Status | Evidence / owner question |
| --- | --- | --- | --- | --- |
| D-001 | Integration status | DKGSwarm is an OpenDKG project serving as the front-facing community marketing, discovery, and coordination layer for OpenDKG apps. | Completed repository move; no content endorsement | This document; no OpenDKG, OriginTrail, TRAC, or Umanitek endorsement claimed. |
| D-002 | Project autonomy | DKGSwarm keeps project leadership, domain, accounts, graph, and deploy authority; GitHub repository ownership follows D-003. | Owner-confirmed | Recorded here. |
| D-003 | Repository shape | Transferred to `OpenDKG/dkgswarm`; no monorepo copy. | Completed 2026-11-08 | Repository id `1391410974`; old namespace redirects. |
| D-004 | License and IP | MIT for this project's work; root `LICENSE`, package metadata, and lockfile aligned; merged PR #1 contribution's ISC basis and third-party notices preserved in `THIRD_PARTY_NOTICES.md`. | Decided by owner; rights-holder/asset list still open | Owner selected MIT; no retroactive MIT claim over the external contribution. |
| D-005 | Domain and website | Keep `dkgswarm.com` and the current site unless a separate migration is approved. | Open | Custody, DNS, TLS, and redirects must be named. |
| D-006 | Donations and funds | Project donations stay separate from umbrella funds; no equal split assumed; publish rules before new umbrella/shared funding. Existing project donations remain independent. | Proposed policy | No umbrella treasury or Open Collective is created. |
| D-007 | Context graph | Owner chooses whether broader OpenDKG topics extend `trac-marketing` or use a separate graph; either needs separate design and opt-in. | Not implemented | No graph created, joined, or renamed. |
| D-008 | Operator enrollment | Broader marketing scope requires explicit operator opt-in. | Proposed contract | No forced enrollment or policy widening. |
| D-009 | Policy authority | Policies remain graph-specific, owner-authenticated, versioned, and pinned. | Proposed contract | Discussions and graph text cannot issue executable policy. |
| D-010 | Maintainer approvals | Maintainers approve merges, deployment, policy release, and closure. | Proposed contract | Umbrella governance gets no implicit production access. |
| D-011 | Contribution terms | If OpenDKG-owned, the adopted Contributor Agreement covers future authorized contributions and DCO sign-off applies under OpenDKG `CONTRIBUTING`; CLA automation is separate. | Open | No repository-specific exception is approved; prior contributions need provenance review. |
| D-012 | Broader governance | Elected or broader participation is a future proposal. | Future proposal | Not created by this document. |
| D-013 | Privacy | No personal contact details or private records in repo, issues, or graph. | Proposed rule | Private exchange between founders is allowed if they choose. |
| D-014 | Public communication | GitHub issue/PR and a short governance note first; no website or brand launch first. | Proposed sequence | Avoid implying endorsement before approval. |

## 8. Support and contribution boundary

The existing support model is retained:

- Issue triage may acknowledge, diagnose, label, and propose a tested pull request.
- Maintainers approve merges, deployment, policy release, and issue closure.
- External issue and pull-request text is untrusted. Any automated analysis or test must run in isolation and without production credentials.
- No new monitor, bot, or auto-triage service is added by this document.
- Never ask a reporter to paste access tokens, writer codes, node tokens, private keys, or personal records.
- Security-sensitive reports follow the repository's current public contact route until a replacement is approved.

Now that the repository is OpenDKG-owned, the adopted Contributor Agreement covers future authorized contributions unless a recorded repository-specific exception applies; DCO sign-off applies under OpenDKG `CONTRIBUTING`. CLA automation is a separate decision and is not active merely because this draft exists. Applicability is separate from technical enforcement; missing automation does not waive the policy. This draft does not retroactively cover prior contributions.

## 9. Blockers and owner questions

1. **Source deployment:** repository reconciliation is complete for the tracked application files; the host deployment lags canonical `main`. Follow [`deployment.md`](deployment.md), then record the deployed SHA. Remaining decision: when the operator approves a restart/copy window, and whether generated site previews are regenerated as part of it.
2. **License:** resolved — the owner selected MIT and the root `LICENSE` and package metadata are aligned. Open; confirm notices for bundled third-party media and record the merged external contribution's provenance without claiming a retroactive assignment.
3. **Target and review evidence:** resolved. `OpenDKG/dkgswarm` is the canonical repository; the §3 provenance and governance review is recorded in PR #3 and `THIRD_PARTY_NOTICES.md`; no separate council transfer vote is stated in the adopted text.
4. **Affiliation vs transfer:** resolved. The owner chose and completed the repository transfer.
5. **Domain, website, Open Collective:** who holds custody, and are any of these in scope now? This draft assumes they remain separate.
6. **Donations:** confirm the existing project donation route stays project-controlled. No umbrella funds or split formula are approved.
7. **External check:** resolved for continuity. The `ai-review/evidence` context survived, and the existing recorder token has admin access; the next protected PR tests publication under OpenDKG.
8. **Contribution terms:** how will DCO sign-off and Contributor Agreement acceptance be recorded now that the repository is OpenDKG-owned, and should CLA automation be enabled? Who reviews prior contributions and any repository-specific exception?
9. **Security contact:** what public security route replaces or supplements the current one without publishing personal details?
10. **Usage claims:** no verified connected-agent or membership count is used in this draft. Any public marketing claim must be separately evidenced.
11. **Muse and channel scope:** what exact Muse URL/product, intended platforms and accounts, and per-account operator permissions?
12. **Platform approvals:** which Reddit, TikTok, or X approvals, OAuth scopes, app reviews or audits, and community rules are already granted?

## 10. Validation and limitations

This change updates the owner-facing docs, public site copy, the MIT license metadata, and the public-copy guard test. It was checked for path allowlist, `git diff --check`, local link/path validity, absence of credential or personal-contact patterns, and consistency with the inspected repository, public endpoint, v19 pin, and adopted OpenDKG governance and Contributor Agreement at `d56279b4f3c25dd8f9e68699d61be23a0c7a6b07`. The official statements in the channel matrix were checked against the linked pages on 2026-11-07; the Reddit Spam page returned HTTP 403 to direct fetch, so its multiple-account statement was checked against indexed official page text. No product or runtime capability is claimed beyond those sources. Root and collector tests run on Node.js 22 and 24; no workflow, dependency, policy, or runtime change is made.

Limitations: production was inspected read-only; no service was restarted or edited. Not verified here: the exact Muse product/runtime, Grok Bot DKG OAuth or scheduled handshake, posting capability, Reddit or TikTok approvals, third-party asset notices, the next post-transfer protected PR and evidence publication, org-level Actions and secrets without `admin:org`, and the source-drift decision. No independent review is claimed by this document.
