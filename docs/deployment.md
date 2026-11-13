# Deployment and source mapping

This repository is the canonical source for the non-website application files listed below.
It is not a complete production image: private environment, installed systemd units, proxy
routing, OAuth/writer stores, databases, node modules, and generated assets stay on the host.
See [`source-coverage.md`](source-coverage.md) for the component-by-component boundary.

Deployment is a manual, reviewed copy. Nothing here pulls, deploys, or restarts on its own.

**The static website is not part of this procedure.** Do not copy, back up, validate, or
restore `/root/npm/data/dkgswarm.com/public` from this document. A website release is a
separate operation with its own review and authorization.

## Runtime paths and services

| Repository path | Host path | Service |
| --- | --- | --- |
| root `*.mjs`, `package.json`, `package-lock.json` | `/root/dkg-public-mcp/` | `dkg-public-mcp.service` |
| `collector/curator.mjs` | `/root/dkg-public-mcp/collector/curator.mjs` | used by the MCP process for curator helpers |
| `collector/*` | `/root/dkg-swarm-webhooks/` | `dkg-swarm-webhooks.service` |
| `scheduler/scheduled-curator.mjs` | `/root/trac-marketing-drafts/scheduled-curator.mjs` | `trac-marketing-curator.service` |
| `scheduler/trac-marketing-curator.agent.md` | `/root/.config/opencode/agents/trac-marketing-curator.md` | read and hashed by the scheduler |
| `site/*` | not part of this procedure | separate website release |
| `docs/*`, `test/*`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | not deployed | source and review only |

The extra `collector/curator.mjs` copy is required because the canonical MCP imports
`./collector/curator.mjs`, while the host runs it from `/root/dkg-public-mcp`. Do not edit the
import path in the deployed copy; copy the file instead.

Keep these private and out of Git and out of release copies: `.env`, `data/`, `node_modules/`,
`policy-current.json`, `writer-codes.json`, OAuth stores, databases, logs, scheduler state and
sessions, generated `social-previews/`, `research-data/`, and host systemd/proxy
configuration.

## Pull and prepare a release copy

Do not pull into a checkout with uncommitted work. Use a clean worktree from the canonical
repository:

```bash
REPO=/root/local-git/dkgswarm
RELEASE=/tmp/opencode/dkgswarm-release
git -C "$REPO" fetch origin
git -C "$REPO" worktree remove --force "$RELEASE" 2>/dev/null || true
git -C "$REPO" worktree add --detach "$RELEASE" <reviewed-sha>
git -C "$RELEASE" rev-parse HEAD
```

Pin the printed SHA in the deploy record. Install dependencies and run the repository checks
in this throwaway worktree; these installs are for review only and are not the runtime copies:

```bash
git -C "$RELEASE" rev-parse HEAD
(cd "$RELEASE" && npm ci)
(cd "$RELEASE/collector" && npm ci)
(cd "$RELEASE" && npm test)
(cd "$RELEASE/collector" && npm test)
node "$RELEASE/scripts/check-imports.mjs" "$RELEASE"
```

Record whether `package.json`, `package-lock.json`, `collector/package.json`, or
`collector/package-lock.json` changed since the last deployed SHA. A changed lockfile means
the runtime roots need the dependency step below.

## Back up tracked runtime files

```bash
BACKUP=/tmp/opencode/dkgswarm-deploy-backup-$(date -u +%Y%m%dT%H%M%SZ)
DRAFTS=/root/trac-marketing-drafts
AGENTS=/root/.config/opencode/agents
install -d "$BACKUP/mcp/collector" "$BACKUP/collector" "$BACKUP/scheduler" "$BACKUP/agents"
cp -a /root/dkg-public-mcp/*.mjs /root/dkg-public-mcp/package.json /root/dkg-public-mcp/package-lock.json "$BACKUP/mcp/"
cp -a /root/dkg-public-mcp/collector/curator.mjs "$BACKUP/mcp/collector/" 2>/dev/null || true
cp -a /root/dkg-swarm-webhooks/*.mjs /root/dkg-swarm-webhooks/package.json /root/dkg-swarm-webhooks/package-lock.json "$BACKUP/collector/"
cp -a "$DRAFTS/scheduled-curator.mjs" "$BACKUP/scheduler/" 2>/dev/null || true
cp -a "$AGENTS/trac-marketing-curator.md" "$BACKUP/agents/" 2>/dev/null || true
echo "$BACKUP"
```

This backs up source and manifests only. Never copy `.env`, `data/`, OAuth/writer stores, or
scheduler state into the backup or the repository.

## Copy reviewed files

```bash
MCP=/root/dkg-public-mcp
COL=/root/dkg-swarm-webhooks
DRAFTS=/root/trac-marketing-drafts
AGENTS=/root/.config/opencode/agents

for f in activity.mjs collective-pushes.mjs curator-intake.mjs issue-writer-code.mjs \
         mcp-cors.mjs oauth.mjs oauth-provider.mjs policy-integrity.mjs \
         posting-context.mjs publish-policy.mjs query-guard.mjs server.mjs \
         social-worker-profile.mjs writer-invitations.mjs package.json package-lock.json; do
  install -m 0644 "$RELEASE/$f" "$MCP/$f"
done
install -d "$MCP/collector"
install -m 0644 "$RELEASE/collector/curator.mjs" "$MCP/collector/curator.mjs"

rsync -a --checksum --exclude node_modules --exclude data --exclude .env \
  --exclude '*.log' "$RELEASE/collector/" "$COL/"

install -m 0644 "$RELEASE/scheduler/scheduled-curator.mjs" "$DRAFTS/scheduled-curator.mjs"
```

`rsync` here does not use `--delete`, so live-only generated files under `$COL` are preserved.
Do not copy `collector/test/` into a production root if the deployment keeps tests out; it is
review-only.

## Install dependencies in the runtime roots

Dependencies must be installed in the directories the services actually execute from. The
release worktree install is not reused, and `node_modules` is never copied from Git.

```bash
MCP=/root/dkg-public-mcp
COL=/root/dkg-swarm-webhooks
(cd "$MCP" && npm ci)
(cd "$COL" && npm ci)
```

Run these whenever either lockfile changed, and any time import validation reports missing
modules. They do not touch `.env`, `data/`, OAuth/writer stores, or logs. If npm cannot reach
the registry, stop before restart and fix the cache/network; do not start a service with
missing dependencies.

The collector's on-chain APR path imports `viem`. Set `TRAC_VIEM_MODULE` to an existing
package or file path already present on the host, or add `viem` through the normal reviewed
collector dependency change (package metadata and lockfile). A manual `npm install` in the
runtime root is removed by the next `npm ci`. If neither is provided, that APR read fails
while the rest of the collector continues to run.

The scheduler has no npm dependencies; it needs the Node.js runtime, `opencode`, `flock`, and
`timeout`.

## Validate before restart

```bash
MCP=/root/dkg-public-mcp
COL=/root/dkg-swarm-webhooks
DRAFTS=/root/trac-marketing-drafts
node --check "$MCP/server.mjs"
node --check "$MCP/oauth.mjs"
node --check "$MCP/mcp-cors.mjs"
node --check "$COL/watcher.mjs"
node --check "$COL/curator.mjs"
node --check "$DRAFTS/scheduled-curator.mjs"

node "$RELEASE/scripts/check-imports.mjs" "$MCP"
node "$RELEASE/scripts/check-imports.mjs" "$COL"
node "$RELEASE/scripts/check-imports.mjs" "$DRAFTS"

for f in server.mjs oauth.mjs oauth-provider.mjs mcp-cors.mjs; do
  cmp "$RELEASE/$f" "$MCP/$f" || echo "DIFF $f"
done
cmp "$RELEASE/collector/curator.mjs" "$MCP/collector/curator.mjs"
cmp "$RELEASE/scheduler/scheduled-curator.mjs" "$DRAFTS/scheduled-curator.mjs"

curl -fsS http://127.0.0.1:27131/health
curl -fsS https://www.dkgswarm.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://www.dkgswarm.com/.well-known/oauth-authorization-server
```

Import validation exits nonzero on a missing relative file or package from the runtime root.
An absent `viem` is reported as an optional warning; when `TRAC_VIEM_MODULE` is explicitly set,
a path that does not resolve as the collector would load it is fatal. A 401 from `POST /mcp`
without a token is expected and must include
`WWW-Authenticate: Bearer ... resource_metadata=...`. An allowed-origin `OPTIONS /mcp`
preflight must return 204 with `Access-Control-Allow-Origin`; this requires the new
`mcp-cors.mjs` deployment.

## Scheduler and curator agent

The scheduler reads `scheduler/trac-marketing-curator.agent.md` indirectly through the
installed agent policy at `/root/.config/opencode/agents/trac-marketing-curator.md` and hashes
both that file and the curator script. A hash path alone does not select the executing agent:
OpenCode discovers Markdown agents from its global config directory (`$XDG_CONFIG_HOME/opencode`
or `~/.config/opencode`), so create that directory and install the file there. Render the
template's `$TRAC_CURATOR_SCRIPT` reference to the deployed curator path before installing it:

```bash
COL=/root/dkg-swarm-webhooks
AGENTS=/root/.config/opencode/agents
install -d "$AGENTS" /root/trac-marketing-drafts
TMP=$(mktemp)
sed "s|\$TRAC_CURATOR_SCRIPT|$COL/curator.mjs|g" \
  "$RELEASE/scheduler/trac-marketing-curator.agent.md" > "$TMP"
install -m 0644 "$TMP" "$AGENTS/trac-marketing-curator.md"
rm -f "$TMP"

HOME=/root \
TRAC_DRAFTS_DIR=/root/trac-marketing-drafts \
TRAC_CURATOR_AGENT_POLICY="$AGENTS/trac-marketing-curator.md" \
node "$RELEASE/scripts/check-curator-config.mjs"
```

The check is model-free. It follows the scheduler's `TRAC_CURATOR_AGENT_POLICY` override,
verifies the policy path is OpenCode's discovered agents path, hashes that same file, rejects a
system or project override, and asks `opencode debug agents --standalone` whether the agent ID
resolves. An override outside the discovered directory fails instead of falling back to the
default. If `XDG_CONFIG_HOME` is set for the service, set it for the check too.

A policy change intentionally stops the next run: archive
`/root/trac-marketing-drafts/data/curator-state.json` only with explicit owner approval, then
let the next scheduled run reevaluate.

Validate without invoking a model:

```bash
node --check "$DRAFTS/scheduled-curator.mjs"
systemd-analyze verify deploy/systemd/trac-marketing-curator.service
```

Do not run `scheduled-curator.mjs` manually as a validation step; it can create an OpenCode
session and call the model. The mocked regression suite covers its scheduling, backoff,
quarantine, cleanup, and refusal paths. Install or change the service/timer only when those
files changed, then `systemctl daemon-reload`; enabling or changing the timer needs operator
approval.

## Restart and confirm

Restart only with operator approval and when the graph and collector are healthy:

```bash
systemctl restart dkg-public-mcp.service
systemctl is-active dkg-public-mcp.service
journalctl -u dkg-public-mcp.service -n 20 --no-pager
```

Restart `dkg-swarm-webhooks.service` separately only when collector files changed. The
collector can retry DKG writes during managed graph recovery; do not restart it because of an
unrelated source change. The scheduled curator runs from its timer; do not start a model run
as part of deployment validation.

## Rollback

```bash
BACKUP=<printed backup directory>
cp -a "$BACKUP/mcp/." /root/dkg-public-mcp/
cp -a "$BACKUP/mcp/collector/curator.mjs" /root/dkg-public-mcp/collector/curator.mjs
cp -a "$BACKUP/collector/." /root/dkg-swarm-webhooks/
cp -a "$BACKUP/scheduler/." /root/trac-marketing-drafts/
cp -a "$BACKUP/agents/." /root/.config/opencode/agents/
```

If the restored manifests differ from the current ones, run `npm ci` again in the affected
runtime root and repeat import validation before restarting. Restore the collector service
only if collector files were changed, and the scheduler unit only if it changed. Re-run the
validation commands and record the restored SHA.

## Run the MCP on another host

The server is not tied to this host's paths. For a reader-only deployment:

```bash
npm ci
DKG_MCP_PUBLIC_URL=https://mcp.example.com \
DKG_MCP_HOST=127.0.0.1 \
DKG_MCP_PORT=27131 \
DKG_MCP_ALLOWED_HOSTS=mcp.example.com \
DKG_API_URL=http://127.0.0.1:9200 \
DKG_API_TOKEN=<private-node-token> \
DKG_MCP_OAUTH_STORE=/srv/dkg/oauth.json \
DKG_MCP_ACTIVITY_STORE=/srv/dkg/activity.sqlite \
DKG_MCP_POLICY_CURRENT=/srv/dkg/policy-current.json \
node server.mjs
```

Put an HTTPS reverse proxy in front and preserve the public `Host` header. Set
`DKG_MCP_PUBLIC_URL` to the exact public origin so PRM, issuer, and audience match. Add the
callback hosts your clients use to `DKG_MCP_OAUTH_REDIRECT_HOSTS` and their browser origins
to `DKG_MCP_CORS_ORIGINS`; both refuse anything not listed.

Reader access needs only the DKG node API. `write_working_memory`, `enable_writer_access`, and
collective-push delivery also need a writer codes file, the curator script
(`TRAC_CURATOR_SCRIPT`), its intake database (`TRAC_CURATOR_INTAKE`), and `/usr/bin/flock`.
Without those, keep the deployment reader-only rather than advertising write support.

## Example systemd units

[`deploy/systemd/`](../deploy/systemd/) contains example units for the MCP, collector, daily
health check, and scheduled curator. They assume a dedicated `dkg` user, code under
`/srv/dkg/`, environment files under `/etc/dkg/`, and writable state under `/var/lib/dkg`.
Adapt every path, create the account and directories with restrictive permissions, then
review the resolved environment and test the units in a staging host:

```bash
systemd-analyze verify deploy/systemd/*.service
systemctl daemon-reload
```

The units harden the service with `ProtectSystem=strict`, `ProtectHome=true`, and explicit
`ReadWritePaths`, so add any extra writable path explicitly. They are examples, not an
installer: this repository does not copy units, create users, restart services, or enable
timers.

## Source parity is not deployed parity

At inspection on 2026-11-13, canonical `main` was
`68c96ecce92c094a8ec275ee86bcf0d43742b084`. The live MCP process ran an older copy with a
host-specific `../dkg-swarm-webhooks/curator.mjs` import. That is a deployment lag, not a
second source of truth. This document makes the non-website copy reproducible; it does not
claim the host was updated. Record the deployed SHA and any files left uncopied in the deploy
record.
