# Scheduled curator

`scheduled-curator.mjs` is the twice-daily review runner for `trac-marketing`. It is a
oneshot service under `flock` and a 12-minute outer `timeout`; the timer runs at 09:20 and
21:20 with a randomized delay. It does not publish Verifiable Memory, change policy, or create
a second schedule.

Each run:

1. builds a deterministic candidate inventory with `collector/curator.mjs list`;
2. stops without a model call when the inventory is empty or unchanged;
3. creates one bounded OpenCode session with scheduled ownership metadata;
4. runs the approved curator agent, checks that the output contains text and no error event;
5. interrupts and archives the session, then records complete, failed, or quarantined state.

The state file under `data/curator-state.json` contains hashes, model, session ID,
status/backoff, and is private. It is never copied into this repository. A policy or curator
change intentionally stops the next run until the owner approves archiving the old state.

Configuration is environment-overridable so the code can run outside the current host:

| Variable | Live default |
| --- | --- |
| `TRAC_DRAFTS_DIR` | `/root/trac-marketing-drafts` |
| `TRAC_CURATOR_SCRIPT` | `/root/dkg-swarm-webhooks/curator.mjs` |
| `TRAC_CURATOR_AGENT_POLICY` | `/root/.config/opencode/agents/trac-marketing-curator.md` |
| `TRAC_CURATOR_AGENT` | `trac-marketing-curator` |
| `TRAC_CURATOR_MODEL` | `9router/cx/gpt-6-sol` |

`trac-marketing-curator.agent.md` is the non-secret agent-policy template. Render its
`$TRAC_CURATOR_SCRIPT` reference to the deployed curator path before installing it. The
scheduler needs Node.js, `opencode`, `flock`, and `timeout`; it has no npm dependencies.

The mocked regression suite is `test/scheduler.test.mjs`; it uses synthetic inventory,
policy, and OpenCode fixtures and never calls a model. See
[`docs/deployment.md`](../docs/deployment.md) for the copy and validation procedure.
