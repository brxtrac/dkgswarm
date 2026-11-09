# Opt-in scout → worker pilot (pre-production)

Status: **implemented with mocks/tests, disabled by default, not live**. No graph create/write,
no X action, no model invocation, no schedule, no production config or policy change.
The scout model choice is still a user decision.

This lane sits beside the existing controlled `trac-marketing` X curator. It does not
change the existing timer, account, voice, approvals, policy pin, OAuth scopes, or graph
lock.

## Remote MCP lifecycle

The public server registers seven job tools **only** when both private paths are set:

- `DKG_MCP_SCOUT_CONFIG` — operator settings and limits
- `DKG_MCP_SCOUT_CAPABILITIES` — server-bound capability grants
- `DKG_MCP_SCOUT_DB` — private SQLite ledger (default `/root/dkg-public-mcp/data/scout-lane.sqlite`)

Without them, the existing tool list and schedule are unchanged.

| Tool | Capability | Purpose |
| --- | --- | --- |
| `scout_jobs_list` | worker or operator | queued jobs plus the caller's claimed jobs; operator may filter state |
| `scout_job_claim` | worker | atomic claim for the grant's accounts, returns fence/revision |
| `scout_job_context` | worker | local brief + ranked same-CG SWM evidence, both untrusted |
| `scout_job_enqueue` | scout | bounded validated opportunities, dedupe/quota/batch checks |
| `scout_job_begin_submit` | worker + publisher | durable pre-submit intent for a pre-authorized job |
| `scout_job_report` | worker (+ publisher for `published`) | drafted/published/failed/skipped/uncertain |
| `scout_job_resolve` | operator | verify/retry/reject an uncertain submission |

`completed` is deliberately **not** a publication outcome. Draft-only jobs cannot be
turned into publication with a worker receipt.

### Server-bound identity and capabilities

OAuth still issues only `dkg:read` / `dkg:write`. Those scopes grant **no** job authority.
The authenticated OAuth **token family** is looked up in the private capability file on
every call:

```json
{
  "version": 1,
  "grants": [
    {
      "id": "worker-main",
      "tokenFamily": "<opaque tokenFamilyId>",
      "roles": ["worker"],
      "accounts": ["acct-main"],
      "revokedAt": null
    }
  ]
}
```

Roles are `scout`, `worker`, `publisher`, `operator`. Every grant must list approved
accounts; a grant without an account is fail-closed. Worker list/claim use the intersection
of the grant accounts and the current operator allowlist, so removing an account hides
queued and already-owned jobs from worker responses. Operator list/resolve remains an
explicit historical-reconciliation path scoped to its own grant accounts. Receipt URLs,
external IDs and publication status are accepted only on the authorized published path
or explicit operator reconciliation; non-publication reports reject them. Deleting the grant or setting a valid `revokedAt` takes effect on the next
call. A caller cannot supply its own worker id, account, or role.

## Authoritative state and durable submit

SQLite is authoritative because the live DKG API has no compare-and-swap. The ledger uses:

- atomic `BEGIN IMMEDIATE` claim with lease, fencing token and revision;
- unique active dedupe on source/platform/action/account/target;
- durable daily quota rows for claims, briefs and account publication;
- bounded job lifetime, draft expiry and cooldown expiry;
- `submitting` with a durable `submit_token` and deadline written **before** external submit;
- expired `submitting` becomes `uncertain`, never automatically queued;
- `uncertain` blocks rediscovery until an operator verifies, retries explicitly or rejects;
- publish quota is reserved before external submission, not after a receipt.

If a worker crashes before `begin_submit`, the lease can be reclaimed safely. If it crashes
after `begin_submit`, the record becomes uncertain and is reconciled by an operator.

### Contractual trust boundary

The server cannot prove what an external browser/social connector did, and cannot force a
malicious worker to acknowledge anything. It can enforce
capability, account, method, action, expiry, fence, revision, submit intent and receipt
shape. Exactly-once external side effects are **not claimed**. The worker must call
`begin_submit` before submitting and report `uncertain` on any ambiguity; the operator
reconciles with the public permalink.

## Scout execution

`scout-lane/scout-run.mjs` is the executable bounded path:

1. fetch a small operator-supplied list of public URLs through `fetch-public.mjs`;
2. call one exact approved/available model with tools disabled and JSON output;
3. accept abstention;
4. validate sources, URLs, accounts, actions, expiry, sensitivity and batch limits;
5. enqueue through the same authoritative ledger.

`createHttpModelAdapter` is the 9router/OpenAI-compatible adapter. It strips only the
verified `9router/` provider prefix for the wire id, rejects remote plaintext endpoints,
rejects redirects, bounds the response before JSON parsing, and uses a bounded token
budget. It is exercised only with mocks pre-production. No live model was called.

`scout-run.mjs` requires a private capability grant with a `tokenEnv` and approved
accounts:

```sh
node scout-lane/scout-run.mjs --config <private> --db <private> \
  --sources <public-urls.json> --capabilities <private> --grant <grant-id>
```

The local grant authenticates only through its configured `tokenEnv` variable, compared
against the grant's SHA-256 `tokenHash`. There is no `--token` argument and no fallback
variable: if `tokenEnv` names `DKG_SCOUT_GRANT_TOKEN`, that is the variable read; otherwise
that variable is irrelevant. The runner re-reads the current config and grant after the
public fetch and again after model output, so a disabled lane, revoked grant or removed
account fails before inference or enqueue. Fetched URLs are the only citations accepted;
fabricated citations and unfetched reply targets are rejected.

## DKG sub-graph adapter

The running node is `@origintrail-official/dkg` 10.0.23. The supported surface is:

- `POST /api/sub-graph/create` `{contextGraphId, subGraphName}`
- `GET /api/sub-graph/list?contextGraphId=...`
- `subGraphName` on `/api/query` and knowledge-asset writes

`scout-lane/subgraph.mjs` performs real create, write and readback calls (mocked in tests):
create is idempotent, the summary is written as a sub-graph **Working Memory draft** with
`finalize:false` and `alsoShareSwm:false`, then queried back. It is not a public or
shared summary and does not publish or finalize anything. It is gated by `mode: live` and
`graph.mirrorEnabled`; both are off. No graph write was made.

The draft summary is sanitized: topic, action, status, timestamps, target/result URL and
at most three public citations. It excludes brief, account scope, worker identity, lease,
fence, revision and submit token. URLs with credential-shaped query parameters and
private/loopback/link-local IPv4/IPv6 hosts are refused.

## Model decision — still pending

Requested "6.1 astra" is not an available provider id. Verified live catalog options:

- `9router/cx/gpt-6.1-sol`
- `9router/cx/gpt-6.1-terra`
- `9router/cx/gpt-6-astra`
- `9router/cx/gpt-6-astra[1m]`

`scoutModel` remains `null`; the example is `mode: "off"`. Live mode requires the exact id
to be in `approvedModels`, in a recent `availableModels` snapshot, and accepted by the
injected availability check. No substitution or inference occurred.

## Files

| Path | Role |
| --- | --- |
| `scout-lane/jobs.mjs` | ledger, claim/fence/lease, quotas, expiry, submit intent, reports |
| `scout-lane/remote.mjs` | authenticated MCP tools and role/account binding |
| `scout-lane/capabilities.mjs` | server-bound grant loading and revocation |
| `scout-lane/scout.mjs`, `scout-run.mjs` | bounded public-read/model/enqueue path |
| `scout-lane/fetch-public.mjs` | DNS-pinned, redirect-checked, size-capped public fetch |
| `scout-lane/subgraph.mjs` | create/write/readback adapter |
| `scout-lane/mirror.mjs` | sanitized Working Memory draft summary payload |
| `scout-lane/cli.mjs` | local operator CLI; not the remote product path |
| `scout-lane/*.example.json` | off-by-default config and empty capability grants |

## Verification

```sh
npm test
npm run test:scout
cd collector && npm test
node --check server.mjs
```

Tests cover the remote lifecycle, missing/revoked capability, separate publisher role,
same-CG context, dry-run/draft refusal, expiry, stale fence/revision, concurrent claim
races, crash before/after submit, atomic quotas, batch limits, injection isolation,
private URL/DNS/redirect rejection, mirror redaction and mocked subgraph readback.
The combined suites pass on Node 22.23.1 and `/usr/local/bin/node24` 24.14.0 in a
read-only, network-isolated sandbox.

## Activation gates (none performed)

1. Fresh independent review of this exact diff.
2. User chooses and verifies one exact model id; run the bounded tools-denied screen.
3. Create private config and capability grants; copy tokens only into env/files, never graph.
4. Optionally create the `scout-jobs` sub-graph with the supported API and verify list.
5. Install the staged scout agent (placeholder model only until step 2).
6. Run one dry-run cycle, inspect ledger, then set `mode: "live"`.
7. Keep `mirrorEnabled: false` until a separate summary-draft review.

## Rollback

Set `mode: "off"` and remove the agent/config paths. The existing X schedule, account,
policy and publisher credentials are untouched. Retain the SQLite audit ledger, including
`uncertain` jobs; do not delete state. Disable the optional mirror before removing it.
