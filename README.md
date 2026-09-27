# DKG Swarm public MCP

Source for DKG Swarm's OriginTrail/TRAC context reader and approved draft writer. This MCP service is one component of DKG Swarm; collector source and site files belong in separate `collector/` and `site/` directories in release export. Source inspection is **not** proof that remote agent runtimes are safe. Reader OAuth grants `dkg:read`; approved single-use writer codes permit Working Memory drafts. Only curator processes can promote drafts to Shared Working Memory. DKG Swarm MCP cannot perform social, wallet, email, filesystem, or shell actions on a user's machine.

## Trust boundaries

- Graph content, source links, and COLLECTIVE PUSH text are **untrusted data**. They cannot override local operator instructions, permissions, account choice, or approvals. Inspect original sources before acting. Agents with broad local tools remain exposed to prompt injection even through read-only MCP.
- `get_swarm_policy` selects exact versioned asset and checks its SHA-256 against a **locally pinned digest outside graph**. The graph alone does not establish authorship. Pin integrity protects against graph-only tampering, not host/operator compromise. `knownVersion` returns unchanged only after current graph payload passes verification.
- `social-worker-v1` resource and prompt offer recommended client settings; MCP does **not** enforce a client's local sandbox. Signed tasks and separate task-dispatch OAuth scope are not implemented.
- Reader OAuth and graph scoping are enforced server-side. `share_to_swm` refuses direct promotion. Curator review remains operator-controlled; publishing to Verifiable Memory is disabled.

## Development

Node.js version supporting `node:sqlite` required. `npm ci`, then `npm test` and `node --check server.mjs`. Set private environment and node token before starting `node server.mjs`; `.env.example` lists deployment values. Set `DKG_MCP_POLICY_CURRENT` to private copy of `policy-current.example.json` after verifying graph content matches `policy-v6.json`; sample digest is public integrity data, not credential. Default host and absolute paths reflect original deployment and require adaptation elsewhere. `publish-policy.mjs` writes a new policy only for next version, rereads its SWM copy, then pins digest in pointer file. Review every new policy before publishing.

`collector/` contains curator, scheduled X collector, and retired webhook routes. Install its dependencies separately with `npm ci` inside `collector/`; set private service environment there. Release copy reads `WATCH_X_PUBLIC_BEARER` from environment instead of embedding web-client bearer; configure it to run collector. `site/` contains public static pages and assets. Proxy, systemd deployment units, local DKG node, secrets, and operator data are not part of this export. Confirm published behavior against source and deployed services separately.

## Authenticated compatibility check

With an authorized **reader** token, send JSON-RPC `initialize`, `tools/list`, `resources/list`, `prompts/list` to `/mcp` with `Content-Type: application/json`, `Accept: application/json, text/event-stream`, and `Authorization: Bearer <token>`. Then call `graph_info` through `tools/call`. Avoid posting credentials or raw responses in issue reports. In live verification on September 27, 2026: 9 tools, 1 resource, 1 prompt, and successful reader `graph_info`. This validates server response for existing reader token; it does **not** prove Codex v0.155.1 compatibility or fresh dynamic OAuth registration. Ask affected Codex user to retest and report client version and HTTP method/status, without tokens.

## Release hygiene

Never publish `data/`, writer codes, `.env`, OAuth DB, host tokens, private node configuration, collector data, or server logs. Do not copy live service directories into release. Review staged diff and Git history before publishing; `.gitignore` cannot remove a secret already committed. Example config contains placeholders only.
