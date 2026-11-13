# Deployment and source mapping

This repository is the canonical source for the application files listed below. It is not a
complete production image: private environment, systemd units, proxy routing, OAuth/writer
stores, databases, node modules, and generated assets stay on the host. See
[`source-coverage.md`](source-coverage.md) for the component-by-component boundary.

Deployment is a manual, reviewed copy. Nothing here pulls, deploys, or restarts on its own.

## Runtime paths and services

| Repository path | Host path | Service |
| --- | --- | --- |
| root `*.mjs`, `package.json`, `package-lock.json` | `/root/dkg-public-mcp/` | `dkg-public-mcp.service` |
| `collector/curator.mjs` | `/root/dkg-public-mcp/collector/curator.mjs` | used by the MCP process for curator helpers |
| `collector/*` | `/root/dkg-swarm-webhooks/` | `dkg-swarm-webhooks.service` |
| `site/*` | `/root/npm/data/dkgswarm.com/public/` | static site behind the edge proxy |
| `docs/*`, `test/*`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | not deployed | source and review only |

The extra `collector/curator.mjs` copy is required because the canonical MCP imports
`./collector/curator.mjs`, while the host runs it from `/root/dkg-public-mcp`. Do not edit the
import path in the deployed copy; copy the file instead.

Keep these private and out of Git and out of release copies: `.env`, `data/`, `node_modules/`,
`policy-current.json`, `writer-codes.json`, OAuth stores, databases, logs, generated
`social-previews/`, `research-data/`, and host systemd/proxy configuration.

## Pull and prepare a release copy

Do not pull into a checkout with uncommitted work. Use a clean worktree from the canonical
repository:

```bash
REPO=/root/local-git/dkgswarm
RELEASE=/tmp/opencode/dkgswarm-release
git -C "$REPO" fetch origin
git -C "$REPO" worktree remove --force "$RELEASE" 2>/dev/null || true
git -C "$REPO" worktree add --detach "$RELEASE" origin/main
git -C "$RELEASE" rev-parse HEAD
```

Pin the printed SHA in the deploy record. Install dependencies only when package metadata
changed since the last deployment:

```bash
git -C "$REPO" diff --name-only <previous-sha>..origin/main -- \
  package.json package-lock.json collector/package.json collector/package-lock.json
```

If that prints any file, run `npm ci` in the release root and in `collector/` before copying.
The collector's optional on-chain APR path needs a host-provided `viem` install; it is not a
packaged dependency.

## Back up tracked runtime files

```bash
BACKUP=/tmp/opencode/dkgswarm-deploy-backup-$(date -u +%Y%m%dT%H%M%SZ)
install -d "$BACKUP/mcp/collector" "$BACKUP/collector" "$BACKUP/site"
cp -a /root/dkg-public-mcp/*.mjs /root/dkg-public-mcp/package.json /root/dkg-public-mcp/package-lock.json "$BACKUP/mcp/"
cp -a /root/dkg-public-mcp/collector/curator.mjs "$BACKUP/mcp/collector/" 2>/dev/null || true
cp -a /root/dkg-swarm-webhooks/*.mjs /root/dkg-swarm-webhooks/package.json /root/dkg-swarm-webhooks/package-lock.json "$BACKUP/collector/"
cp -a /root/npm/data/dkgswarm.com/public/*.html /root/npm/data/dkgswarm.com/public/*.css \
  /root/npm/data/dkgswarm.com/public/*.js /root/npm/data/dkgswarm.com/public/*.json \
  /root/npm/data/dkgswarm.com/public/llms.txt "$BACKUP/site/"
echo "$BACKUP"
```

## Copy reviewed files

```bash
MCP=/root/dkg-public-mcp
COL=/root/dkg-swarm-webhooks
WEB=/root/npm/data/dkgswarm.com/public

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

rsync -a --checksum "$RELEASE/site/" "$WEB/"
```

`rsync` here does not use `--delete`, so live-only generated files are preserved. Site
social-preview URLs are generated per release; regenerate previews after a copy if the
deployment keeps that routine.

## Validate before restart

```bash
node --check "$MCP/server.mjs"
node --check "$MCP/oauth.mjs"
node --check "$MCP/mcp-cors.mjs"
node --check "$COL/watcher.mjs"
node --check "$COL/curator.mjs"

for f in server.mjs oauth.mjs oauth-provider.mjs mcp-cors.mjs; do
  cmp "$RELEASE/$f" "$MCP/$f" || echo "DIFF $f"
done
cmp "$RELEASE/collector/curator.mjs" "$MCP/collector/curator.mjs"
cmp "$RELEASE/site/join.html" "$WEB/join.html"

curl -fsS http://127.0.0.1:27131/health
curl -fsS https://www.dkgswarm.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://www.dkgswarm.com/.well-known/oauth-authorization-server
```

A 401 from `POST /mcp` without a token is expected and must include
`WWW-Authenticate: Bearer ... resource_metadata=...`. An allowed-origin `OPTIONS /mcp`
preflight must return 204 with `Access-Control-Allow-Origin`; this requires the new
`mcp-cors.mjs` deployment.

## Restart and confirm

Restart only with operator approval and when the graph and collector are healthy:

```bash
systemctl restart dkg-public-mcp.service
systemctl is-active dkg-public-mcp.service
journalctl -u dkg-public-mcp.service -n 20 --no-pager
```

Restart `dkg-swarm-webhooks.service` separately only when collector files changed. The
collector can retry DKG writes during managed graph recovery; do not restart it just because
the site changed.

## Rollback

```bash
BACKUP=<printed backup directory>
cp -a "$BACKUP/mcp/." /root/dkg-public-mcp/
cp -a "$BACKUP/mcp/collector/curator.mjs" /root/dkg-public-mcp/collector/curator.mjs
cp -a "$BACKUP/collector/." /root/dkg-swarm-webhooks/
cp -a "$BACKUP/site/." /root/npm/data/dkgswarm.com/public/
systemctl restart dkg-public-mcp.service
```

Restore the collector service only if collector files were changed. Re-run the validation
commands and record the restored SHA.

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

[`deploy/systemd/`](../deploy/systemd/) contains example units for the MCP, collector, and
daily health check. They assume a dedicated `dkg` user, code under `/srv/dkg/public-mcp` and
`/srv/dkg/webhooks`, environment files under `/etc/dkg/`, and writable state under
`/var/lib/dkg`. Adapt every path, create the account and directories with restrictive
permissions, then review the resolved environment and test the units in a staging host:

```bash
systemd-analyze verify deploy/systemd/dkg-public-mcp.service
systemctl daemon-reload
systemctl enable --now dkg-public-mcp.service
```

The units harden the service with `ProtectSystem=strict`, `ProtectHome=true`, and a single
`ReadWritePaths` entry, so add any extra writable path explicitly. They are examples, not an
installer: this repository does not copy units, create users, restart services, or enable
timers.

## Source parity is not deployed parity

At inspection on 2026-11-13, canonical `main` was
`68c96ecce92c094a8ec275ee86bcf0d43742b084`. The live MCP process ran an older copy with a
host-specific `../dkg-swarm-webhooks/curator.mjs` import, and the live site copy predated the
current OpenDKG site text. Those are deployment lags, not a second source of truth. This
document makes the copy reproducible; it does not claim the host was updated. Record the
deployed SHA and any files left uncopied in the deploy record.
