# Source coverage and publication boundary

This repository publishes the non-website application source for DKG Swarm: the public MCP
connector, OAuth authorization server, writer-invitation and policy tooling, collector and
curator, scheduled curator, their tests, and deployment examples. "All source" here means
every owned runtime component of those services, not every file on an operator host and not
the marketing website build. The only owned application source kept out of this revision is
the separately reviewed, default-off scout branch described below; the website, research,
game, and private-state surfaces are listed explicitly under exclusions.

Checked on 2026-11-13 against canonical `main` and the live host. Private state is
deliberately excluded; code that reads or writes that state is included so the behavior can
be audited.

## Runtime components

| Component | Repository source | Live mapping | Notes |
| --- | --- | --- | --- |
| Remote MCP + OAuth server | `server.mjs`, `oauth.mjs`, `oauth-provider.mjs`, `mcp-cors.mjs` | `dkg-public-mcp.service`, `server.mjs` | Streamable HTTP at `/mcp`; discovery, DCR, `/authorize`, `/token`; scoped CORS and 405 for unsupported `/mcp` methods |
| MCP read tools and limits | `server.mjs`, `query-guard.mjs`, `posting-context.mjs`, `collective-pushes.mjs` | same service | Bounded single-pattern reads, posting-context ranking, collective-push listing |
| MCP write and writer boundaries | `server.mjs`, `issue-writer-code.mjs`, `writer-invitations.mjs`, `curator-intake.mjs` | same service | Reader `dkg:read`; `dkg:write` only after a single-use operator code; drafts only; curator promotion is separate |
| Policy verification and publication | `policy-integrity.mjs`, `publish-policy.mjs`, `policy-v18.json`, `policy-v19.json`, `policy-current.example.json` | same service; private `policy-current.json` pin | Sample policy snapshots are public content already served by `get_swarm_policy`; the live pointer is private and not published |
| Activity metrics | `activity.mjs` | same service | Private SQLite path is configuration, not source |
| Social-worker profile and prompts | `social-worker-profile.mjs` | same service | Describes client-side limits; cannot enforce them |
| Collector HTTP service | `collector/server.mjs`, `collector/network-stats.mjs`, `collector/health-public.mjs` | `dkg-swarm-webhooks.service` | Registration, fan-out, stats, watcher administration |
| Collector watcher and curator | `collector/watcher.mjs`, `collector/curator.mjs`, `collector/QUERIES.md` | same service; `curator.mjs` also copied beside the MCP process | The MCP imports `./collector/curator.mjs`; the host copy is a path mapping, not different source |
| Daily health check | `collector/health-check.mjs` | `dkg-swarm-health.service` and timer | Oneshot; reads the graph and writes a status file outside Git |
| Scheduled curator | `scheduler/scheduled-curator.mjs`, `scheduler/trac-marketing-curator.agent.md` | `trac-marketing-curator.service` and timer; agent policy at `/root/.config/opencode/agents/trac-marketing-curator.md` | Deterministic inventory, bounded model run, session ownership check, cleanup, backoff and three-failure quarantine. Host paths are environment-overridable; defaults match the live install |
| Service definitions | `deploy/systemd/*.service`, `deploy/systemd/*.timer` | installed units under `/etc/systemd/system/` | Templates show environment-file and working-directory shape; not installed by this repository |
| Import validation | `scripts/check-imports.mjs` | release worktree / runtime roots | Resolves every static import from the importing file; fails on missing relative files or packages and reports optional `viem` |
| Static site | `site/*` | public web root behind the edge proxy | Tracked for history and already public. Website content/build work is outside this publication change; these files are not modified or deleted here |
| Tests and CI | `test/*`, `collector/test/*`, `.github/workflows/ci.yml` | CI only | Root suite (MCP, scheduler, import checks) and collector suite run on Node.js 22 and 24 |
| Docs and licensing | `README.md`, `docs/*`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | not deployed | MIT owner license; merged PR #1 ISC notice preserved |

## Owned service and timer inventory

Every installed unit whose command or trigger can run DKG Swarm code was checked read-only on
2026-11-13. This inventory is the check that prevents a live entry point from being missed.

| Unit or timer | Command / trigger | Disposition |
| --- | --- | --- |
| `dkg-public-mcp.service` | `node /root/dkg-public-mcp/server.mjs` | Included; root `*.mjs` and manifests |
| `dkg-swarm-webhooks.service` | `node /root/dkg-swarm-webhooks/server.mjs` | Included; `collector/*` |
| `dkg-swarm-health.service` + `.timer` | `node /root/dkg-swarm-webhooks/health-check.mjs`, daily | Included; `collector/health-check.mjs` |
| `trac-marketing-curator.service` + `.timer` | `flock` + `timeout 12m` + `node /root/trac-marketing-drafts/scheduled-curator.mjs`, twice daily | Included; `scheduler/*`, agent policy template |
| `dkgswarm.service` | `node /var/www/dkgswarm.com/game/server.js` | Website/game surface, excluded with the website scope; game code was removed from the repository |
| `dkgswarm-holder-value.service` + `.timer` | `node /root/research-app/holder-value.js` | Website research data generator, excluded |
| `dkgswarm-research-refresh.service` + `.timer` | `node /root/research-app/cli.js refresh` | Website research data generator, excluded |
| `dkgswarm-utility-atlas.service` + `.timer` | `node /root/research-app/utility-atlas.js` and `social-previews.js` | Website research/social-preview generator, excluded |
| `dkg.service` | OriginTrail DKG daemon | Third-party runtime, pinned 10.0.23, not vendored |
| `dkgbuidl-curator`, `dkgbuidl-mcp`, `opendkg-coordinator`, `opendkg-wiki-backup`, `hermes-*`, `tracabot-*`, `tracaplot-*` | Separate projects | Not DKG Swarm components |

No user crontab entries were present. The timer units above are the only DKG Swarm schedules
observed; no additional systemd `ExecStart` pointed at a DKG Swarm source tree.

Agent instruction files under `/root/.config/opencode/agents/` are operator tooling. Only
`trac-marketing-curator.md` is read and hashed by owned runtime code; the other agent files
(including the health agent) are not loaded by the included service units.

## Private, generated, or third-party

These are intentionally not in Git. Their absence does not hide owned source: the code that
uses them is above.

| Excluded item | Reason |
| --- | --- |
| `.env` files | Credentials and deployment-specific values. `.env.example` documents required names with placeholders only |
| `data/`, OAuth store, writer-code store, activity/intake/watcher SQLite databases, scheduler state, logs | Runtime state and personal or account data |
| `/root/trac-marketing-drafts/data/curator-state.json`, OpenCode sessions and transcripts | Scheduler hashes, model, session ID, status/backoff, and private model output; never copied to Git |
| `policy-current.json` | Private pointer to the live policy digest; publishing it would mix a private pin with the public samples |
| `node_modules/` | Reinstalled from the committed lockfiles |
| Installed systemd units, proxy configuration, host paths | Host-specific; templates and a copy procedure are provided instead |
| OriginTrail DKG node (`@origintrail-official/dkg` 10.0.23), its keystore, `auth.token`, node config and databases | Third-party runtime, not DKG Swarm source. Install from the upstream project at `https://github.com/OriginTrail/dkg`; this repository only calls its HTTP API |
| `viem` | Optional collector APR integration. Imported from the collector runtime as `viem`, or from `TRAC_VIEM_MODULE` when the operator points at an existing module entry point. No bundled install and no source copy |
| `research-app/` | Website research and social-preview data generator. It feeds public site pages, is outside the MCP/collector runtime, and keeps private data. Excluded with the website scope; not a hidden dependency of the published services |
| Generated social previews, research data, fonts, live roadmap | Generated website artifacts, reproducible from their generators, which are outside this change |
| Legacy game/Express service (host `/var/www/dkgswarm.com/game`) and removed game code | Website/game surface removed from this repository by commit `e520709`; the host copy is website legacy, excluded with the website scope |
| Historical policy snapshots before v18 | Public at the time but not needed to audit current code. Two consecutive snapshots are included so the version/digest format and change from v18 to v19 are reviewable |

## Experimental source

The opt-in scout/worker lane is not part of this revision. It exists as local branch
`scout-x-optin-lane` at `172155d22edafbe9a50345ae05f65f821635ed57`, based on
canonical `main` and disabled unless private config and capability paths are set. Its
independent review evidence is retained outside this repository. Merging it into the stable
service would change the advertised task-dispatch profile and add a second job state
machine, so it is kept as a separate source candidate rather than mixed into this branch.
Publication of that branch is a separate decision; activating it remains an operator action
requiring its own review.

Other services on the same host (for example `dkgbuidl`, `aipharmagent`, and the wiki) are
separate projects and are not DKG Swarm components.

## How live behavior maps to source

| Live behavior | Code | Difference from this revision |
| --- | --- | --- |
| Public MCP process | `server.mjs` and imports | Host copy is older (2026-10-15) and imports `../dkg-swarm-webhooks/curator.mjs`; this revision uses `./collector/curator.mjs` and adds OAuth/CORS changes. Deployment lag, documented in [`deployment.md`](deployment.md) |
| Collector process | `collector/*` | Tracked source matched the host at inspection; only package metadata and lockfile were newer in Git |
| Static site | `site/*` | Host snapshot predates the repository's current site text; website work is out of scope here |
| Health timer | `collector/health-check.mjs`, `deploy/systemd/dkg-swarm-health.*` | Source matches; schedule and status path are host configuration |
| Scheduled curator | `scheduler/scheduled-curator.mjs`, `scheduler/trac-marketing-curator.agent.md` | Host source used for this publication. The tracked version parameterizes draft directory, curator script, agent policy, agent name and model through environment variables and invokes the inventory with the running Node binary; defaults match the live install. State and sessions stay private |
| Policy served to readers | `get_swarm_policy` in `server.mjs`, `policy-integrity.mjs` | Live policy is v19; the repository ships v18 and v19 snapshots, not the private live pointer |

The live host was inspected read-only. No deployment, restart, policy publication, or graph
write was performed while preparing this revision.

## Residual trust notes

- `/mcp` enforces the `DKG_MCP_CORS_ORIGINS` allowlist. The SDK `/register` and `/token`
  handlers keep permissive CORS; they authenticate with client ID plus PKCE/body
  credentials, not cookies, and open dynamic registration is intentional.
- Dynamic registration trusts an allowlisted callback *host* not to expose an open redirect
  on an arbitrary path. Exact registered URIs are still required; review a host before
  adding it to `DKG_MCP_OAUTH_REDIRECT_HOSTS`. Loopback redirects follow RFC 8252.

## Reproduce the checks

```bash
npm ci && npm test                 # root (includes scheduler and import checks), Node.js 22 and 24
cd collector && npm ci && npm test # collector, Node.js 22 and 24
node --check server.mjs
node --check collector/watcher.mjs
node --check scheduler/scheduled-curator.mjs
node scripts/check-imports.mjs
```

`test/oauth-e2e.test.mjs` starts the real server with temporary stores and an unreachable DKG
API, then exercises discovery, dynamic registration, PKCE, token exchange, refresh, MCP
`initialize` over raw HTTP and the SDK client transport, `tools/list`, reader write refusal,
origin rejection, and method handling. `test/scheduler.test.mjs` runs the scheduler against
synthetic inventory, agent-policy and OpenCode fixtures with no model call. No production
credential or account is used.
