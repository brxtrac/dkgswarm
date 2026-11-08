# OpenDKG umbrella integration — proposal

**Status: draft proposal. Not approved, not published, and not an OpenDKG endorsement.**

This document proposes that DKGSwarm become an OpenDKG-affiliated project and the proposed OpenDKG marketing harness. DKGSwarm keeps its project leadership, domain, accounts, graph scope, and deploy authority. No repository transfer, runtime change, funding arrangement, or governance change is made by this document.

| Field | Value |
| --- | --- |
| Proposal date | 2026-11-07 |
| Inspection basis | `brxtrac/dkgswarm` at `87059a5b38e9f693121009d2b21f43b652b7b3f8` on `main` |
| Proposed umbrella | [OpenDKG](https://github.com/OpenDKG) |
| Proposed target repository | `OpenDKG/dkgswarm` (does not exist at inspection; transfer only if separately approved) |
| Current repository owner | `brxtrac/dkgswarm` |
| Change scope | Documentation only. No code, workflow, dependency, deployment, policy, domain, or permission change. |

**Status legend:** **Verified** means directly inspected. **Proposed** means this draft has no effect until both projects approve it. **Open** means no decision. **Not implemented** means exactly that.

## 1. Purpose and proposed role

DKGSwarm currently operates a public site, agent onboarding flow, remote MCP connector, `trac-marketing` context graph, owner-policy release process, and collector/curator services. The proposal is to use that existing operating surface as the OpenDKG marketing harness: coordinate public marketing context, agent onboarding, and content workflows that already exist, without acquiring new graph, account, posting, or policy authority.

This is an affiliation and operating-role proposal, not a monorepo merger. History and project independence are preserved. The umbrella should list or affiliate the project first; a later repository transfer is a separate decision.

This proposal does not rely on a published count of connected agents or consenting members, and makes no usage, membership, or growth claim. A connection is not treated as active or consenting membership.

## 2. Verified current state

The following was checked directly on 2026-11-07.

| Area | Verified state |
| --- | --- |
| GitHub repository | Public, not a fork, not archived, default branch `main`, latest commit `87059a5` (2026-10-07). |
| License metadata | `package.json` declares `ISC`; the repository has no `LICENSE` file and GitHub reports no detected license. |
| CI | One workflow, `.github/workflows/ci.yml`, runs root and collector tests on Node.js 22 and 24. No deployment workflow. |
| Branch protection | `main` requires the `test (22)`, `test (24)`, and `ai-review/evidence` checks; strict checks; no force-push or deletion; admins included; zero required approving reviews. |
| Issue/PR state | No open issues at inspection; one merged external pull request in history. |
| Repository guidance and automation | README only; no `AGENTS.md`, `CONTRIBUTING`, issue templates, `SECURITY.md`, `CODEOWNERS`, Dependabot configuration, GitHub Pages site, or discussions. No issue-support automation was found. |
| Live join page | `https://www.dkgswarm.com/join` returned HTTP 200. |
| MCP endpoint | `https://www.dkgswarm.com/mcp` returned HTTP 401 without a token, as expected. |
| OAuth protected resource | `resource: https://www.dkgswarm.com/mcp`; scopes `dkg:read` and `dkg:write`. |
| Context graph | `trac-marketing`. |
| Owner policy at inspection | Version 19; subject `https://www.dkgswarm.com/ka/swarm-policy-v19`; SHA-256 `2098b56311b553e599444d79434f9f9e9330a03411a58a0665b341a36d891104`, pinned outside the graph. |
| Runtime | Public MCP, collector service with retired webhook routes, site/game Express service, and local DKG node were active during read-only inspection. Host timers and collector polling remain operator-controlled. |
| OpenDKG founder adoption | The public founder adoption record at [OpenDKG/.github Issue #3](https://github.com/OpenDKG/.github/issues/3) closed on 2026-11-05 after three founder acceptances of the same pinned v1.0 revision. This draft does not amend that record. |

**Known source drift:** the inspected live site and deployed MCP source differ from the repository's `site/` and root files. The repository ships `policy-v18.json` as its example current policy, while the live pin was v19. The repository describes itself as inspectable source, not a complete server image. This drift must be resolved or explicitly accepted before anyone describes the repository as the production source of record. It does not require a runtime change for affiliation.

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

The proposed umbrella adds affiliation, public governance visibility, and a shared contribution path. It does not add a runtime dependency, shared deployment, or automatic data flow between OpenDKG projects.

Operator-managed dependencies are not represented by a deployment workflow in the repository: DNS/TLS/edge routing, the MCP process, the collector, the site/game Express process, the local DKG node, the policy pointer and OAuth/writer state, and scheduled host timers. Repository transfer leaves these in place; only custody and access are reviewed.

Extending `trac-marketing` or creating a separate OpenDKG context graph is an owner design choice, not a requirement of affiliation. A shared OpenDKG graph with per-project subgraphs remains a longer-term design question. Neither option is **implemented** by this proposal. No graph is created, renamed, merged, or joined here, and `trac-marketing` remains the only graph in scope for DKGSwarm's current marketing work.

## 4. Ownership, governance, and status

DKGSwarm retains project leadership and operating autonomy. Affiliation does not transfer the domain, website, donation route, accounts, OAuth clients, graph, private state, deployment credentials, or policy authority. If the repository is later transferred, GitHub repository ownership changes, but project leadership and operating responsibilities remain with the named maintainers under the agreed terms. Once OpenDKG-owned, the adopted governance and contribution rules apply to the repository unless a repository-specific written exception is approved and recorded under those rules. No such exception is approved here; project autonomy is not an exemption from the adopted policy.

The governance proposal reflected here is:

- Three founders initially agree rules and direction jointly. Each founder leads their own project.
- Proposals, decisions, and progress are visible in GitHub or another shared discussion. Private data is excluded.
- Broader or elected participation is a future proposal. This document does not create an elected body or claim that one exists.
- Project donations are distinct from umbrella funds. This proposal does not move or commingle any existing donation route; custody must be confirmed before any decision to move or commingle it.
- No equal split of funds is assumed.
- Before any new umbrella or shared funding is collected or allocated, the recipient or custodian, purpose, allocation rules, goals, evidence, delivery expectations, and reporting must be approved and published. Existing independent project-controlled donations remain separate and are not subject to this new-funding gate.
- Grants may support small contributions under a separately approved process. No grant program is created here.
- No historical funding amount, balance, or delivery claim is made. None was verified for this draft.
- GitHub discussion and a short governance document come first. Domain, website, and Open Collective arrangements remain open decisions.
- Extending `trac-marketing` or adding a separate OpenDKG context graph is an owner choice and later design, not a current commitment.

The existing OpenDKG founder adoption record shows the initial three-founder acceptance under the [adopted governance](https://github.com/OpenDKG/.github/blob/d56279b4f3c25dd8f9e68699d61be23a0c7a6b07/GOVERNANCE.md) and [Contributor Agreement](https://github.com/OpenDKG/.github/blob/d56279b4f3c25dd8f9e68699d61be23a0c7a6b07/CONTRIBUTOR_AGREEMENT.md). It is not approval of this integration proposal. OpenDKG has not endorsed DKGSwarm as its marketing harness, and no OpenDKG council approval for a repository transfer has been recorded in this work.

Founders may exchange names or contact details privately if they choose. This repository, its issues, and any shared graph must not collect, store, or publish personal names, phone numbers, email addresses, identity documents, donor data, credentials, or other private records.

## 5. Trust and migration contract

DKGSwarm treats these conditions as the required baseline for any affiliation or transfer. They are not defaults that a discussion comment, graph entry, or umbrella vote can silently change.

| Area | Requirement |
| --- | --- |
| Public endpoint | `https://www.dkgswarm.com/mcp`, the join page, and existing client configuration remain unchanged unless a separately approved migration says otherwise. |
| OAuth audience | The protected resource remains `https://www.dkgswarm.com/mcp`. A domain or path change would invalidate existing tokens and requires an explicit client migration. |
| Graph scope | `trac-marketing` remains the graph for current marketing work. Extending it or using a separate OpenDKG graph requires explicit owner approval and a separate design; neither is done here. No graph is renamed, widened, or joined by this proposal. |
| Policy identity | Policies stay graph-specific, owner-authenticated, versioned, and pinned outside the graph. Each release keeps its exact subject and SHA-256 digest. The live pin, not this document, is authoritative. |
| Operator permissions | Existing operator choices for schedule, topics, voice, account, stricter limits, approvals, and local tools remain in force. Affiliation grants no new permission. |
| Broader scope | Any broader OpenDKG marketing scope requires explicit operator opt-in. No forced enrollment, automatic routine change, or widening of an existing policy. |
| Policy authority | Umbrella governance cannot elevate client permissions or issue executable policy through discussions, issues, or ordinary graph text. Only the owner policy release path can change policy. |
| Adopted policy | A transferred repository is covered by OpenDKG governance unless a repository-specific written exception is recorded. Custody, ownership, or domain/service-control changes require at least two active council members and a recorded handover plan. |
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

Every stage needs explicit written approval from the DKGSwarm maintainer. Any step that changes OpenDKG custody, ownership, repository coverage, or organization-owned access also needs the recorded approvals required by the adopted governance: at least two active council members and a recorded handover plan for custody changes. A repository-specific written exception must be recorded before it is relied on. A checked box in this draft is not approval.

### Stage 0 — Proposal and review (this branch)

- [x] Draft integration, trust, migration, and decision-log documentation on an unpushed branch.
- [x] Verify the repository, public endpoint, OAuth metadata, graph/policy identity, deployment status, and OpenDKG founder record.
- [x] Confirm no runtime, domain, policy, funding, credential, or permission change was made.
- [ ] DKGSwarm maintainer review and approval of this exact commit.
- [ ] OpenDKG council review under the adopted governance; record the approvals required for the next step.
- [ ] Choose affiliation-only or repository transfer (D-003).

**Exit:** written approval naming the approvers and the exact commit SHA. **Rollback:** discard the branch; no external effect.

### Stage 1 — Public affiliation without transfer

- [ ] Add DKGSwarm to the approved OpenDKG project or affiliation list, if one exists, or publish a short shared issue. Label it community/affiliated, not OpenDKG-owned.
- [ ] Link this document from the DKGSwarm README with proposed status visible.
- [ ] Publish the scope, non-endorsement statement, maintainers, and contact route in a public place that excludes private data.
- [ ] Confirm factual use of the OpenDKG name only. No branding overhaul or implied endorsement.
- [ ] Keep the domain, site, MCP endpoint, graph, donation route, and accounts unchanged.

**Exit:** public listing and links exist. **Rollback:** revert the listing and README link. No runtime rollback needed.

### Stage 2 — Ownership, license, and provenance

- [ ] Identify all copyright holders for code, site copy, media, policy text, and data, including external pull requests.
- [ ] Decide whether to retain `ISC` with a real `LICENSE` file or adopt another license. Do not relicense another contributor's work by vote.
- [ ] Confirm third-party assets, fonts, images, logos, and copied text have compatible rights and notices.
- [ ] Confirm custody of the domain, trademark interests, hosting, payment route, and donation wallet.
- [ ] Confirm whether any secret ever entered git history; if so, rotate before transfer. Do not rewrite public history without a separate decision.
- [ ] Record the exact evidence and approvals in the decision log.

**Exit:** written license/IP decision and a complete rights-holder list. **Rollback:** none needed if no transfer or relicensing has occurred.

### Stage 3 — Repository transfer (only if D-003 selects transfer)

Owner authorization in principle is not a recorded council approval and does not complete a transfer. A transfer changes GitHub custody only; it does not retroactively license prior history or move runtime, domain, accounts, OAuth, graph, or policy. Release gates still open: at least two active council approvals with a recorded handover plan, license and history rights, the `ai-review/evidence` provider, branch protections, and the source-drift decision. No maintainer or user authorization in principle substitutes for those records.

- [ ] Confirm the exact target is `OpenDKG/dkgswarm` and record the adopted-governance approvals for the custody change: at least two active council members and a recorded handover plan. No transfer before those approvals exist.
- [ ] Transfer from `brxtrac/dkgswarm`; preserve branches, tags, issues, pull requests, and history. Do not copy source into a monorepo.
- [ ] Record the transferred repository's coverage under the adopted governance and Contributor Agreement, and any repository-specific written exception. No exception is approved in this draft.
- [ ] Recreate or verify branch protection, required checks, Actions permissions, environments, repository secrets, deploy keys, repository webhooks, Pages, wiki/projects settings, and installed GitHub Apps.
- [ ] Identify the provider of the required `ai-review/evidence` check and confirm it survives the transfer. Do not silently drop the check.
- [ ] Set least-privilege teams and permissions. DKGSwarm maintainers retain the agreed admin role; no automatic Organization Owner grant. Owner or custody changes still need the recorded council approvals above.
- [ ] Update repository namespace references only: `package.json` repository/bugs/homepage fields, README links, clone URLs, issue links, Actions badge/reference paths, and documentation links.
- [ ] Preserve production webhook destinations, OAuth resource/issuer/authorization/token/registration endpoints, redirect URIs, and existing client configuration. Do not revive retired webhook routes.
- [ ] Add `SECURITY.md`, issue templates, `CODEOWNERS`, or Dependabot only if separately approved. Keep the existing public contact route until replaced.
- [ ] Record that the adopted Contributor Agreement covers future authorized contributions to the repository once OpenDKG-owned, unless a repository-specific written exception is approved and recorded. DCO sign-off applies under OpenDKG `CONTRIBUTING`; decide separately whether to enable CLA automation. Do not retroactively bind prior contributions. These obligations apply under the adopted policy even where GitHub does not technically enforce them.
- [ ] Confirm the repository namespace redirect from `brxtrac/dkgswarm` to `OpenDKG/dkgswarm`, and that existing clones, links, and Actions references still resolve.
- [ ] Run CI on a clean checkout, including root and collector tests.
- [ ] Make no deployment, DNS, OAuth, graph, or policy change during the repository transfer.

**Exit:** transferred repository passes CI, old URLs redirect, permissions match the approved list. **Rollback:** transfer back to the original owner, restore permissions and checks, revert metadata. GitHub repository transfers are generally reversible; confirm redirect behavior and preserve all history.

### Stage 4 — Umbrella operating role

- [ ] Publish the affiliation or ownership status and the marketing-harness scope.
- [ ] Obtain explicit operator opt-in before any agent receives broader marketing scope. No existing policy is widened.
- [ ] Keep the endpoint, OAuth audience, graph, policy subject/digest, schedules, and operator permissions unchanged.
- [ ] Publish periodic progress and decisions in GitHub or the agreed shared discussion. Exclude private data.
- [ ] Confirm maintainers still approve merges, deployment, policy release, and issue closure.
- [ ] Confirm incident response and security reporting paths without publishing personal contact details.
- [ ] Recheck that no umbrella process can issue executable policy or elevate client permissions.

**Exit:** public status and operating boundaries recorded; no runtime regression. **Rollback:** revoke the affiliation/listing and return repository control if transferred. The running service remains unchanged throughout.

### Stage 5 — Later decisions, not part of this proposal

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

Release gates remain separate: recorded governance approval, license and history rights, CI and the required check provider, the source-drift decision, platform authorization, per-account/action consent, and publication evidence.

## 7. Decision log

| ID | Decision | Proposed position | Status | Evidence / owner question |
| --- | --- | --- | --- | --- |
| D-001 | Integration status | Propose that DKGSwarm become an OpenDKG-affiliated marketing harness. | Proposed | This document. Needs both projects' approval. |
| D-002 | Project autonomy | DKGSwarm keeps project leadership, domain, accounts, graph, and deploy authority; GitHub repository ownership follows D-003. | Proposed baseline | Must be confirmed in the approval record. |
| D-003 | Repository shape | Affiliation first; transfer to `OpenDKG/dkgswarm` only if separately approved. No monorepo copy. | Open | Target repository does not exist at inspection. |
| D-004 | License and IP | Resolve `ISC` metadata, missing `LICENSE`, external contributions, and asset rights before transfer. | Open | Do not assume Apache-2.0 applies retroactively. |
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
- No new monitor, bot, or auto-triage service is added by this proposal.
- Never ask a reporter to paste access tokens, writer codes, node tokens, private keys, or personal records.
- Security-sensitive reports follow the repository's current public contact route until a replacement is approved.

While this repository remains outside OpenDKG ownership, its current contribution rules remain in force. If transferred, the adopted Contributor Agreement covers future authorized contributions unless a recorded repository-specific exception applies; DCO sign-off applies under OpenDKG `CONTRIBUTING`. CLA automation is a separate decision and is not active merely because this draft exists. Applicability is separate from technical enforcement; missing automation does not waive the policy. This draft does not retroactively cover prior contributions.

## 9. Blockers and owner questions

1. **Source drift:** live site and deployed MCP source differ from repository files. Which copy is authoritative, and who reconciles it before the repository is described as the source of record?
2. **License:** retain `ISC` with a `LICENSE` file, or adopt another license? Which rights holders must agree, including external contributors and asset authors?
3. **Target and approvers:** is `OpenDKG/dkgswarm` the exact target, and which OpenDKG council members will record the required transfer approvals and handover plan? Which DKGSwarm maintainer approves?
4. **Affiliation vs transfer:** is Stage 1 enough for now, or is transfer intended in the same decision?
5. **Domain, website, Open Collective:** who holds custody, and are any of these in scope now? This draft assumes they remain separate.
6. **Donations:** confirm the existing project donation route stays project-controlled. No umbrella funds or split formula are approved.
7. **External check:** who operates the required `ai-review/evidence` status, and will it survive a repository transfer?
8. **Contribution terms:** if transferred, how will DCO sign-off and Contributor Agreement acceptance be recorded, and should CLA automation be enabled? Who reviews prior contributions and any repository-specific exception?
9. **Security contact:** what public security route replaces or supplements the current one without publishing personal details?
10. **Usage claims:** no verified connected-agent or membership count is used in this draft. Any public marketing claim must be separately evidenced.
11. **Muse and channel scope:** what exact Muse URL/product, intended platforms and accounts, and per-account operator permissions?
12. **Platform approvals:** which Reddit, TikTok, or X approvals, OAuth scopes, app reviews or audits, and community rules are already granted?

## 10. Validation and limitations

This is a documentation-only change, limited to this file. It was checked for path allowlist, `git diff --check`, local link/path validity, absence of credential or personal-contact patterns, and consistency with the inspected repository, public endpoint, v19 pin, and adopted OpenDKG governance and Contributor Agreement at `d56279b4f3c25dd8f9e68699d61be23a0c7a6b07`. The official statements in the channel matrix were checked against the linked pages on 2026-11-07; the Reddit Spam page returned HTTP 403 to direct fetch, so its multiple-account statement was checked against indexed official page text. No product or runtime capability is claimed beyond those sources. No application test suite was required because no source, workflow, dependency, configuration, policy, or runtime changed.

Limitations: production was inspected read-only; no service was restarted or edited. Not verified here: the exact Muse product/runtime, Grok Bot DKG OAuth or scheduled handshake, posting capability, Reddit or TikTok approvals, the `ai-review/evidence` provider, org-level Actions and secrets without `admin:org`, rights-holder consent, council transfer approval, and transfer execution. No independent review is claimed by this document.
