# Platform campaign profiles — draft groundwork

**Status: draft documentation. Not active policy, not an owner-issued graph asset or pin, not platform approval, not an OpenDKG endorsement, and not a transfer record. No account, browser, runtime, policy, or service change is made here.**

This document is the minimum local groundwork for future browser-first account monitoring and posting: humans create and sign in to their own accounts, each platform/account/campaign is explicitly opted in, and each platform can carry different rules. It defines draft profiles, a campaign opt-in contract, account onboarding checks, and browser readiness gates. It launches no pilot.

## 1. Scope and non-goals

In scope:

- Draft per-platform policy profiles for X (existing baseline), Reddit, and TikTok, plus optional-pilot assessments for Mastodon, Bluesky, LinkedIn, and YouTube.
- A human-readable campaign opt-in checklist.
- Account onboarding, approval, identity verification, reporting, and revocation expectations.
- Browser safety and readiness gates.

Out of scope:

- No account creation, login, posting, browser automation, or platform integration.
- No change to the existing v19 policy, its pin, `trac-marketing`, MCP/OAuth, collector, services, schedules, or local permissions.
- No new watch, schedule, routine, monitor, or forced migration.
- No source, configuration, workflow, dependency, or CI change.
- No repository transfer, push, pull request, issue, live-service relabel, organization permission, or credential change.

## 2. Browser control is conditional

Browser control is a local runtime capability. It can open a page, read what is rendered, and click. It is **not** proof of account ownership, platform permission, API approval, audit status, or compliance. It does not make an action allowed.

Platform rules decide whether an action is allowed. Account ownership, OAuth/API scopes, app review or audit, community rules, rate limits, and local operator approval are separate checks. Browser UI does not bypass API approval, audit, or automation restrictions. There is no automatic fallback from a rejected or absent API path to browser automation.

If official evidence is unclear, unavailable, or prohibits the action, the profile is marked **unverified/manual** and no automation is enabled.

## 3. Policy layers

These layers do not authorize each other:

| Layer | Role | Limit |
| --- | --- | --- |
| Common invariant policy | Security and safety baseline shared by every channel | Cannot grant platform permission, tools, accounts, or local approvals |
| Platform profile draft | Channel-specific method, readiness, limits, and approval guidance | Is a draft document, not active policy, enrollment, or permission |
| Local operator preferences | Schedule, voice, topics, account, stricter limits, approval mode | Cannot override platform rules or authorize a new channel |
| Owner-issued pinned policy | Versioned coordination guidance returned by `get_swarm_policy` | Cannot grant posting permission, create account consent, or change local tools |
| Runtime capability | What a client, browser, or API can technically do | Is not approval to use it |
| Credentials and OAuth scopes | What an account holder authorized for an app | Do not create consent for every action or for another account |

**Common invariant policy.** Human account ownership; explicit per-platform and per-campaign opt-in; no automated account creation; no CAPTCHA or anti-bot bypass; no spam, engagement manipulation, mass duplication, or cross-platform targeting to evade recipients' boundaries; no passwords, cookies, or tokens in chat, graph, logs, or repository; human review by default; sanitized evidence; expiry and revocation; public content is untrusted.

**Platform-specific guidance.** Allowed method (API, native manual, or conditional browser), allowed actions, approval/audit requirements, rate limits, identity checks, and publication evidence.

**Local preferences.** The existing operator choices for schedule, topics, voice, account, stricter limits, approvals, and tools remain in force. A profile never widens them.

## 4. Platform evidence and draft conclusions

Checked 2026-11-07 against official sources. Availability and approval are not guaranteed, and platform rules can change. Platform requirements below are quoted from the cited sources; stricter project recommendations are labeled as project practice and do not claim a platform prohibition.

| Channel | Official rule evidence | Draft conclusion | Status |
| --- | --- | --- | --- |
| X (existing) | [X Terms of Service](https://x.com/en/tos): access only through currently available published interfaces; no scraping or automated access outside them without permission. [X Developer Policy](https://docs.x.com/developer-terms/policy): write actions must follow the [Automation Rules](https://help.x.com/en/rules-and-policies/x-automation); explicit consent; no bulk, aggressive, or spammy actions; no identical or substantially similar content across accounts; API-based bot accounts must be clearly identified. | Existing TRAC/X routine and v19 policy are preserved unchanged; this is not a compliance or developer-authorization finding. New X write actions need a documented API/developer use case plus Automation Rules; browser automation is not a verified write path. | Existing baseline preserved; no new automation approved |
| Reddit | [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy): explicit approval required before API access; app registration; no spam or substantially similar content across subreddits; no manipulation or circumvention. [Data API Terms](https://redditinc.com/policies/data-api-terms): use the provided access information/OAuth; do not mask identity; commercial use needs a separate agreement. [User Agreement](https://redditinc.com/policies/user-agreement): no automated access or collection except as permitted or under a separate agreement; scraping needs prior written consent. | API only after approval; manual/draft otherwise. The cited terms do not allow browser automation, and this project profile does not fall back to it. | Draft/manual gate |
| TikTok | [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/): Direct Post requires an audit for public reach; unaudited clients are limited to private viewing and up to five users per 24 hours; intended use is authentic creators posting original content, not a utility for accounts a team manages; consent, preview, and status checks are required. [TikTok Terms of Service](https://www.tiktok.com/legal/page/global/terms-of-service/en): no automated scripts to collect information from or otherwise interact with the Services; no spam or unauthorized commercial solicitation; no bypassing access restrictions. | This project profile proposes no browser automation, consistent with the cited terms. API path is deferred until audit, use-case eligibility, and original assets exist; manual/draft only for now. | Draft/manual gate; API deferred |
| Mastodon | [Status API](https://docs.joinmastodon.org/methods/statuses/): posting is documented through the API. [Profile settings](https://docs.joinmastodon.org/user/profile/): an optional bot account flag exists and is a visual indication only, not a posting requirement. Per-instance rules vary and are not global. | API-capable optional pilot candidate. Recommended project practice: set the optional bot flag and keep human review; check the target instance's rules. No browser automation needed. | Suggested optional pilot; not approved; instance rules unverified |
| Bluesky | [AT Protocol bot tutorial](https://atproto.com/guides/bot-tutorial): official bot path uses an app password and scheduled posting, and recommends a bot self-label as best practice; regular automated posting is welcome; interaction bots should only interact when tagged. [Developer Guidelines](https://bsky.network/docs/developer-guidelines/): no automated or bulk interactions, including notifications, follows, likes, or replies; no automated follower/interaction generation or account generation. [Community Guidelines](https://bsky.social/about/support/community-guidelines): no spam, no artificial manipulation of features or social signals, no undisclosed commercial content. | API posting candidate. No automated engagement. Recommended project practice: use the bot self-label for transparency and keep human review. | Suggested optional pilot; not approved |
| LinkedIn | [API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use): access content through the APIs, not scraping, crawling, or other automation outside them; do not create multiple apps to circumvent limits. [User Agreement](https://www.linkedin.com/legal/user-agreement): no bots or unauthorized automated methods to access the Services, add or download contacts, send messages, or create, comment, like, share, or re-share posts. | Not recommended for browser automation. Only an approved LinkedIn API program is a possible route, subject to eligibility. | Not recommended now |
| YouTube | [YouTube Terms of Service](https://www.youtube.com/t/terms): no automated access except public search engines following `robots.txt` or with prior written permission; no unsolicited promotional or mass content; no manipulation of metrics. [YouTube API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service): API uploads carry notice, channel-choice, and monitoring obligations. [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) apply. | The official terms allow automated access with prior written permission. This project profile proposes no browser automation absent verified written permission. An API upload path exists but needs quota/approval, original approved assets, and a human workflow. | Project profile proposes no browser automation; not a first pilot |

Direct fetches of the X Automation Rules page and the Reddit Responsible Builder Policy returned HTTP 403/CAPTCHA. Their conclusions use the linked official page text through indexed or mirrored copies, plus the accessible X Developer Policy that incorporates the Automation Rules. Re-check exact wording before any activation.

## 5. Draft profile fields

Every platform, account, and campaign record uses these fields. A filled draft is still not an active policy or permission.

| Field | Meaning |
| --- | --- |
| `profile_id` | Stable local identifier for the platform/account/campaign profile |
| `status` | `draft`, `manual-only`, `suggested-pilot`, `not-recommended`, or `baseline` |
| `channel` and `account_handle` | Platform and public handle; never a password, cookie, or token |
| `owner` and `approver` | Human account owner and the person recording approval |
| `scope` | Campaign topics, accounts, and public surfaces covered |
| `allowed_actions` | `monitor`, `draft`, `publish`, or `none`; default is `none` for a new profile |
| `approval_mode` | `draft-only`, `manual-approve`, or a stricter local mode; autonomous publish is not a pilot default |
| `limits` | Per-hour/per-day caps, platform rate limits, timezone, and local stricter limits |
| `privacy` | Public-only, or a separately approved private surface; DMs and private inboxes are never inferred from login |
| `method` | API, native manual, or conditional browser; must match current platform rules |
| `identity_check` | How the account identity is verified before an action |
| `evidence` | Sanitized status or permalink, timestamp, and result; no secrets or private screenshots |
| `expiry` and `revocation` | Review date and the logout/revoke route that stops future actions |
| `dependencies` | Platform approval, audit, quota, instance rules, or asset rights that must exist first |

## 6. Draft profiles

### X — existing baseline

- **Status:** existing baseline; behavior preserved unchanged, not verified for platform compliance.
- **Scope:** the current TRAC/X routine only. The v19 policy, pin, graph, services, and OAuth remain unchanged. Preserving this behavior is not verification of platform compliance or developer-use-case authorization.
- **Allowed actions:** existing behavior only, preserved unchanged. New monitoring or posting is not approved or verified by this draft.
- **Method:** the existing API/client path, preserved unchanged. No current developer-use-case authorization is verified here. Browser automation is not a verified write path.
- **Approval:** owner approval; any applicable X developer/use-case authorization and Automation Rules must be confirmed separately and are not verified here.
- **Limits and timezone:** existing operator settings; no new schedule.
- **Privacy:** public content only. DMs and private inboxes are not inferred from login.
- **Evidence:** existing operator records; no new evidence claim here.
- **Expiry/revocation:** existing operator controls.
- **Blocker:** no current X developer/use-case authorization or platform-compliance evidence was verified; preservation is not approval.

### Reddit — draft/manual gate

- **Status:** `manual-only`; draft.
- **Scope:** selected public communities and campaign topics, if later approved.
- **Allowed actions:** human reading, drafting, and posting. No automated posting, automated commenting, or automated monitoring until API approval exists.
- **Method:** Reddit Data API only after Responsible Builder Policy approval and app registration. The cited terms do not allow browser automation, and this project profile does not fall back to it.
- **Approval:** platform API approval, target subreddit rules, and owner approval.
- **Limits and timezone:** platform limits plus local caps; record timezone.
- **Privacy:** public content only. No DMs, private modmail, or private inboxes.
- **Evidence:** sanitized post permalink and status.
- **Expiry/revocation:** dated review; revoke the token or stop the session.
- **Blocker:** API approval, app registration, and subreddit rules are unverified.

### TikTok — draft/manual gate; API deferred

- **Status:** `manual-only`; draft. The API path is deferred.
- **Scope:** original video campaigns with approved assets only.
- **Allowed actions:** human upload through the native app and human review. No automated posting.
- **Method:** this project profile proposes no browser automation, consistent with the cited terms. API only after audit, use-case eligibility, and the required consents; do not use the API as a private utility uploader.
- **Approval:** TikTok audit/approval, asset rights, and owner approval.
- **Limits and timezone:** platform caps and local limits; record timezone.
- **Privacy:** public content only. No DMs.
- **Evidence:** publish status and sanitized permalink; an accepted upload is not proof of publication.
- **Expiry/revocation:** dated review; revoke authorization or stop the session.
- **Blocker:** audit/use-case approval, original assets, and human workflow are not in place.

### Mastodon — suggested optional pilot

- **Status:** `suggested-pilot`; not approved.
- **Scope:** one selected instance and account, public campaign topics.
- **Allowed actions:** API posting and monitoring after owner opt-in. No automated engagement.
- **Method:** Mastodon API with OAuth; recommended project practice: set the optional bot flag and keep human review; check the target instance's rules.
- **Approval:** owner approval and instance-rule confirmation. There is no global platform approval.
- **Limits and timezone:** instance rate limits plus local caps; record timezone.
- **Privacy:** public content only. No DMs.
- **Evidence:** status URL and timestamp.
- **Expiry/revocation:** dated review; revoke the token or log out.
- **Blocker:** instance choice, instance rules, account identity, and owner approval are unverified.

### Bluesky — suggested optional pilot

- **Status:** `suggested-pilot`; not approved.
- **Scope:** one account, public campaign topics.
- **Allowed actions:** API posting and monitoring. No automated replies, likes, follows, or other engagement in the pilot.
- **Method:** AT Protocol API/app password; recommended project practice: use the bot self-label for transparency and keep human review.
- **Approval:** owner approval and compliance with the Developer Guidelines and Community Guidelines.
- **Limits and timezone:** platform rate limits plus local caps; record timezone.
- **Privacy:** public content only. No DMs.
- **Evidence:** post URL/AT URI and timestamp.
- **Expiry/revocation:** dated review; revoke the app password or session.
- **Blocker:** owner approval and rate-limit review are unverified; the bot self-label is a recommendation, not a platform prerequisite.

### LinkedIn — not recommended for browser automation

- **Status:** `not-recommended` for browser automation.
- **Allowed actions:** none through browser automation. A later approved API program would still need its own review.
- **Method:** official LinkedIn API program only, if eligible. This project does not use scraping, crawling, or unauthorized browser/bot-driven posting; an API path approved under that program is not prohibited by this project rule.
- **Approval:** LinkedIn API program eligibility and owner approval.
- **Blocker:** no API program approval; unauthorized browser automation is not an allowed route.

### YouTube — not a first pilot

- **Status:** `not-recommended` for browser automation; not a first pilot.
- **Allowed actions:** API upload only with original approved assets and human review.
- **Method:** YouTube Data API subject to quota, approval, and Developer Policies. This project profile proposes no browser automation absent verified written permission; the official terms allow automated access only for public search engines following `robots.txt` or with prior written permission.
- **Approval:** YouTube/Google API setup, asset rights, and owner approval.
- **Limits and timezone:** API quota plus local caps; record timezone.
- **Privacy:** public or unlisted as the campaign says; no private data in public metadata.
- **Evidence:** video URL and processing/publish status.
- **Expiry/revocation:** dated review; revoke the API authorization.
- **Blocker:** API quota/approval, original assets, and human workflow are not in place.

## 7. Campaign opt-in contract

Complete this per platform, account, and campaign. Checked boxes are still not an active policy, platform approval, or transfer record.

- [ ] I own or control this account, and I will sign in natively. I will not use another person's credentials.
- [ ] I opt in to this platform channel separately from the campaign topic.
- [ ] I choose monitoring only or posting. Login alone does not opt me in to either.
- [ ] The allowed actions are listed, and no DMs or private inboxes are included unless separately approved.
- [ ] The approval mode is `draft-only` or `manual-approve`. No autonomous publish during a pilot.
- [ ] Limits, timezone, and platform rate limits are recorded.
- [ ] Privacy is limited to public content unless a separate private-surface approval exists.
- [ ] The current platform method is confirmed. Browser use is conditional, and there is no automatic fallback from a rejected API to the UI.
- [ ] Account identity is verified before actions, and each account uses its own browser profile or a verified shared profile.
- [ ] A human reviews every post before publish, and a pilot publish needs explicit confirmation.
- [ ] Evidence is limited to a sanitized permalink/status, timestamp, and result. No secrets, cookies, or screenshots with private data.
- [ ] The profile has an expiry date and a revocation route. Logout or revoke stops future actions.
- [ ] I will not use spam, engagement manipulation, mass duplication, cross-platform targeting to evade recipients' boundaries, automated account creation, or CAPTCHA/2FA bypass.
- [ ] I understand platform availability and approval are not guaranteed, and rules can change.

Owner signature/record, date, and profile version:

## 8. Account onboarding, approval, verification, and reporting

- **Creation and sign-in:** a human creates the account natively and completes CAPTCHA, 2FA, email, and phone checks. No automated account creation or challenge bypass.
- **Secrets:** no passwords, cookies, tokens, or recovery codes in chat, graph, logs, repository, or screenshots. Use a local secret store or the browser's own profile.
- **Identity verification:** before an action, confirm the displayed handle/profile matches the approved record and that the active account is the intended one. Verify again after a session restore.
- **Shared browser state:** use separate browser profiles per account where possible. If bots share a profile, verify the account identity at the start of every session. Never post from an unverified state or across accounts.
- **Approval record:** platform, public handle, campaign ID, allowed actions, approval mode, limits/timezone, privacy, evidence route, expiry, approver, and date.
- **Revocation:** logout, revoke the token, or delete the session. Future actions stop; pending drafts remain unsent.
- **Reporting:** record the sanitized status or permalink, timestamp, action, result, and error class. Do not record session secrets or private data. On an ambiguous submit or wrong-account risk, stop and check the actual post state before any retry.

## 9. Browser readiness gates

No browser action is enabled for a platform until all gates pass for that platform, account, and campaign:

1. Actual scheduled browser/session access was observed, not assumed.
2. The authorized account identity was verified.
3. Explicit action permissions exist for this campaign.
4. The current platform allowed method is confirmed. If the action is prohibited or unverified, no browser automation.
5. Human review is the default; drafts stay local first.
6. A pilot publish has explicit confirmation.
7. After an ambiguous submit, no retry until the actual post state is checked.
8. An accepted upload is not treated as published; verify the public status or permalink.
9. Sanitized evidence is recorded.
10. There is no automatic fallback from a rejected API to the browser UI.
11. Posting and monitoring are separately opted in.
12. Logout or revoke stops future actions.

If a gate fails, retain the currently approved work, report the blocker, and do not widen scope.

## 10. Separation from OpenDKG mission opt-in and active policy

Platform channel selection and campaign topic selection are independent. A user can choose a platform without joining an OpenDKG mission topic, or join a topic without enabling a platform. Nothing here silently extends the current `trac-marketing`/X work.

Additional OpenDKG mission topics require separate explicit opt-in. Extending `trac-marketing` or creating another graph remains a future owner decision with separate design and approval.

The existing v19 policy, pin, graph, services, and OAuth are unchanged. This document does not modify `get_swarm_policy`, add a graph schema, or resolve policy from generic graph text.

A future active channel policy would need:

- The common security invariants above.
- Channel-specific versioning and readiness guidance.
- An owner-authenticated pinned release and explicit operator approval.
- An exact activation mechanism decided later.

Draft documents cannot be used as active policy. Unverified generic graph text is never an acceptable policy source. If a runtime or platform capability does not match the approved profile, keep the currently approved work and report the blocker.

## 11. Transfer and affiliation boundaries

The owner has approved the repository move to `OpenDKG/dkgswarm` and selected MIT as this project's license. The transfer is not executed. Adopted `GOVERNANCE.md` §3 requires a provenance and governance review for a newly transferred repository; §2's two-active-council-member and handover-plan rule is scoped to adding organization owners, changing account custody, or changing domain/service control. Open items: provenance review evidence, the external-contribution and third-party notice record, the required `ai-review/evidence` check provider, and the source-drift decision.

This section is documentation only and does not transfer the repository, relabel the live service, or alter organization permissions or credentials. It uses approved-move, transfer-pending wording and makes no endorsed or transfer-complete claim. Do not retry missing `admin:org` organization Actions or secrets endpoints.

## 12. Recommendation shortlist

1. **Mastodon and Bluesky** are the simpler first optional pilots if official evidence supports them and the owner opts in. Both have documented API posting paths and do not need browser automation. Mastodon's optional bot flag is recommended project practice, and the target instance's rules still apply. Bluesky's bot self-label is recommended project practice, not a platform prerequisite, and no automated engagement is proposed. Neither is approved here.
2. **X** stays on its existing baseline, preserved unchanged but not re-verified for platform compliance or developer-use-case authorization. New actions need documented developer/use-case authorization and compliance with the Automation Rules; browser automation is not a verified write path.
3. **Reddit and TikTok** stay manual/draft until platform approval exists. Reddit needs Responsible Builder Policy/API approval. TikTok needs audit, use-case eligibility, and original assets. The cited terms do not allow browser automation for either.
4. **Video platforms** need original approved assets and a human workflow. YouTube API upload is conditional on quota, approval, and Developer Policies. This project profile proposes no browser automation absent verified written permission; the official terms allow automated access only for public search engines following `robots.txt` or with prior written permission.
5. **LinkedIn** is not recommended for browser automation. Only a platform-approved API program is a possible route, and it is not prohibited by this project rule.

Platform availability and approval are unknown, and no allowed marketing behavior is guaranteed.

## 13. Validation and limitations

This is a documentation-only change. It was checked for changed-path allowlist, `git diff --check`, local link/path validity, absence of credential or personal-contact patterns, and consistency with `docs/opendkg-umbrella.md`, the existing v19 pin, and the inspected repository state.

The official platform pages linked above were checked on 2026-11-07. The X Automation Rules page and the Reddit Responsible Builder Policy page returned HTTP 403/CAPTCHA to direct fetch; their conclusions use indexed or mirrored copies of the official text and the accessible X Developer Policy. Exact wording must be rechecked before any activation. Bot labels and flags are presented as recommended project practice, not platform posting prerequisites. X preservation is not treated as compliance or developer-authorization evidence. The YouTube browser restriction is a proposed project rule absent verified written permission, not a claim that the official terms forbid all automation. No application test suite was required because no source, workflow, dependency, configuration, policy, or runtime changed.

Not verified here: account ownership, platform approvals or audits, API quotas, Mastodon instance rules, LinkedIn or YouTube program eligibility, actual browser behavior, and any posting capability. No independent review is claimed by this document.
