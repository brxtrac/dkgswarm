# X intelligence queries

## Collector safety bounds

Authenticated curator COLLECTIVE PUSH drafts have a maximum lifetime of two hours from `issuedAt` to `expiresAt`, inclusive. This conservative review window limits stale coordination without changing downstream schedules or granting action permissions. Longer-lived drafts are rejected, not silently shortened. Trusted-source direct pushes retain their separate 30-minute lifetime.

Curator intake lists up to 40 nonterminal drafts, with pushes first and stable queue-time/name ordering. Rejections acknowledge the selected intake revision. Historical terminal decisions are filtered before the limit without rewriting old intake rows.

Completed deliveries undergo rolling exact-content checks in batches of 40 every `WATCH_DKG_RECONCILE_MS` (default five minutes). The persisted completion-time/post-ID/stage cursor wraps after each sweep; a sweep takes approximately `ceil(completed deliveries / 40) + 1` intervals. Unavailable verification does not advance its cursor or consume delivery attempts.

Health checks default to no restarts and read-only collector access. Quarantine is yellow; missing or stale successful polling beyond 15 minutes, or unavailable/empty WM or SWM, is red. Enabled search older than 30 minutes and trusted-push work overdue by five minutes are yellow. Public health overlays live collector polling and quarantine on the daily graph snapshot; `checkedAt` remains the graph-check timestamp, not a real-time SWM guarantee.

`connectedInstallations` counts connections, `monitoredAccounts` counts all watched accounts, and `legacyRegisteredAccounts` counts enabled legacy registry handles. None implies consent-based membership enrollment.

Tests use injected health dependencies, temporary databases and mocked graph calls. Run `DKG_API_TOKEN_FILE=/dev/null DKG_API_URL=http://127.0.0.1:1 npm test` for an additional production-default guard.

Target context graph: value of `DKG_PUBLIC_GRAPH_ID`. Use `view: "shared-working-memory"`.

## Relevant posts and confidence

```sparql
SELECT ?post ?category ?confidence ?evidenceLevel WHERE {
  ?analysis a <https://www.dkgswarm.com/ontology/x/Classification> ;
    <https://schema.org/about> ?post ;
    <https://www.dkgswarm.com/ontology/x/category> ?category ;
    <https://www.dkgswarm.com/ontology/x/confidence> ?confidence ;
    <https://www.dkgswarm.com/ontology/x/evidenceLevel> ?evidenceLevel .
}
ORDER BY DESC(?confidence)
```

## Posts mentioning an account

```sparql
SELECT ?post ?text WHERE {
  ?post <https://schema.org/mentions> <https://x.com/origin_trail> ;
    <https://schema.org/articleBody> ?text .
}
```

## Source evidence for one post

```sparql
SELECT ?author ?published ?text ?evidence WHERE {
  BIND(<https://x.com/i/status/POST_ID> AS ?post)
  ?post <https://schema.org/author> ?author ;
    <https://schema.org/articleBody> ?text .
  OPTIONAL { ?post <https://schema.org/datePublished> ?published }
  OPTIONAL {
    ?analysis <https://schema.org/about> ?post ;
      <https://www.dkgswarm.com/ontology/x/evidence> ?evidence .
  }
}
```
