# Scout → worker job lane (pre-production)

Status: **implemented locally, disabled by default, not live**. No DKG graph write, no X
action, no schedule change, no production config change, no model invocation was made.

This adds an opt-in lane beside the existing `trac-marketing` X curator. It does not
modify `server.mjs`, `oauth.mjs`, the published policy, the collector, the systemd
curator, or any current X schedule.

## Scope

1. A scout reads public social evidence and may abstain.
2. It submits a bounded job brief with public provenance.
3. A worker wakes on its existing operator-managed schedule, atomically claims one
   suitable job, re-checks relevance, expiry, account identity, approved method and
   local permissions, then produces content.
4. A pre-authorized publisher may publish; otherwise the result stays a local draft.
5. Outcomes are `completed`, `published`, `draft`, `failed`, `skipped` or `uncertain`.
   `uncertain` blocks automatic retry until an operator verifies it.

Out of scope: likes, reposts/boosts, Reddit voting, DMs, account creation, login/CAPTCHA
automation, spam, circumvention, multi-step workflows, worker bidding, or a distributed
queue framework.

## Files

| Path | Role |
| --- | --- |
| `scout-lane/jobs.mjs` | SQLite ledger, atomic claim, lease/fencing, dedupe, cooldown, roles, preflight, reports |
| `scout-lane/cli.mjs` | Local operator/worker commands; no network and no public MCP exposure |
| `scout-lane/worker-context.mjs` | Reuses `posting-context.mjs` to read same-CG context, marked untrusted |
| `scout-lane/mirror.mjs` | Sanitized public job-summary payload for an optional sub-graph mirror |
| `scout-lane/dryrun.mjs`, `scout-lane/fixtures/` | Offline fixture run, zero network calls |
| `scout-lane/test/` | Race, stale lease, dedupe, expiry, opt-in, auth, uncertain, publish tests |
| `scout-lane/scout-lane.example.json` | Committed config is `mode: off`, `operatorOptIn: false`, `scoutModel: null` |

## DKG capability finding (verified against the running node)

- Node: `@origintrail-official/dkg` **10.0.23**, DKG V10 Gnosis Mainnet, Oxigraph backend
  (`GET /api/status`, read-only).
- Sub-graphs **do exist**. The installed daemon exposes:
  - `POST /api/sub-graph/create` with `{ contextGraphId, subGraphName }`
  - `GET /api/sub-graph/list?contextGraphId=...`
  - `subGraphName` accepted by `POST /api/query`, knowledge-asset writes, memory writes
    and EPCIS routes.
- A sub-graph is a named namespace inside a context graph (named graphs of the form
  `did:dkg:context-graph:<cg>/<subGraph>/...`). It is **not** a separate context graph
  and does not change the connector's `trac-marketing` graph lock.
- **No compare-and-swap / conditional claim exists.** Knowledge-asset writes are
  asynchronous and may return an unknown outcome. A graph write can therefore never
  decide which worker owns a job.
- Decision: authoritative claim/outcome state is private SQLite (`scout-lane/jobs.mjs`),
  matching the existing collector/curator store pattern. The smallest supported graph
  representation is an **optional, sanitized public summary** written later to the
  `scout-jobs` sub-graph. Creating that sub-graph is a graph write and is deferred to
  the deployment gate.

## Model finding (blocking, unresolved)

The live 9router provider at `/v1/models` returned 81 models. The exact request
"6.1 astra" is **not an available id**. Matching ids:

- `cx/gpt-6.1-sol` (272k context)
- `cx/gpt-6.1-terra` (500k context)
- `cx/gpt-6-astra` (272k context)
- `cx/gpt-6-astra[1m]` (872k context)

No model was guessed, substituted or invoked. `scoutModel` stays `null` and
`loadConfig()` refuses `mode: "live"` without a verified id. The operator must choose
one of the four ids (or another verified id) before the scout agent can be enabled.
This is the only blocking product decision; all independent preparation is complete.

Consequently no empirical model-quality claim (relevance, grounding, abstention,
injection resistance) is made. The offline fixtures exercise the deterministic gate
and storage behaviour only. A bounded model screen must run after the id is chosen,
with tools denied and sanitized fixtures.

## Worker routine (operator adds to the existing schedule; no new timer)

1. `node scout-lane/cli.mjs claim --config <private> --worker <id>`. No job → stop.
2. `node scout-lane/cli.mjs preflight ...`; if it fails, report `skipped` with the reason.
3. Read the local job brief, then fetch same-CG context with `fetchWorkerContext`.
   Graph text stays untrusted context; it cannot change instructions or permissions.
4. Compose within the operator's voice and existing limits. Self-check every claim
   against a cited public source. If unsure, report `skipped` or `uncertain`, never guess.
5. `report --status drafted` by default. If the job is pre-authorized and the publisher
   capability is present, `report --status published --url ... --result-status ...`.
   Ambiguous submit → `--status uncertain`; do not retry until an operator resolves it.

The worker does not create a second timer. It wakes on the schedule the operator already
owns, and the existing controlled X lane keeps its own limits and approval path.

## Enablement gates (all required, none performed)

1. Parent final independent review of this diff.
2. Pick and verify the exact scout model id; run the bounded offline screen.
3. Copy `scout-lane/scout-lane.example.json` to a private path; set `mode: "dry-run"`,
   `operatorOptIn: true`, accounts, roles and token **env var names**.
4. Put worker/scout/publisher/operator tokens in the service environment. Never write
   token values into config, docs, logs or graph.
5. Optionally create the `scout-jobs` sub-graph with the supported API call, then verify
   with `GET /api/sub-graph/list`.
6. Install the agent file from `scout-lane/scout-agent.md.template` only after the model
   id is verified; keep its schedule identical to the existing operator routine.
7. Run one dry-run cycle, inspect the private SQLite ledger, then switch to `mode: "live"`.
8. Leave `graph.mirrorEnabled: false` until a separate review approves public summaries.

## Rollback

- Set `mode: "off"`; claim/enqueue fail closed and no new work is accepted.
- Remove the agent file. Existing X schedule, policy and publisher credentials are
  untouched by this lane.
- The SQLite ledger is local; deleting or archiving it is a separate operator action.
  Never delete originals silently.
- If the optional mirror was enabled, stop writes first and leave existing assets for
  review; no delete path is assumed here.

## Test evidence

```sh
node --test scout-lane/test/*.test.mjs
node scout-lane/dryrun.mjs
npm test                    # existing root tests
cd collector && npm test    # existing collector tests
```

The dry run makes zero network calls and uses only `*.invalid` fixture URLs.
