# X intelligence queries

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
