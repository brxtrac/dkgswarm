import test from "node:test";
import assert from "node:assert/strict";
import { assertReadSparql } from "../query-guard.mjs";

test("read queries require bounded results and reject federated or write operations", () => {
  assert.equal(assertReadSparql("SELECT ?s WHERE { ?s <https://schema.org/url> ?o } LIMIT 50"), "SELECT ?s WHERE { ?s <https://schema.org/url> ?o } LIMIT 50");
  assert.equal(assertReadSparql("ASK { ?s <https://schema.org/url> ?o }"), "ASK { ?s <https://schema.org/url> ?o }");
  for (const query of ["SELECT ?s WHERE { ?s <https://schema.org/url> ?o }", "SELECT ?s WHERE { ?s <https://schema.org/url> ?o } LIMIT 101",
    "SELECT ?s WHERE { SERVICE <http://localhost:9200> { ?s <https://schema.org/url> ?o } } LIMIT 10",
    "CONSTRUCT { ?s <https://schema.org/url> ?o } WHERE { ?s <https://schema.org/url> ?o }", "DELETE WHERE { ?s <https://schema.org/url> ?o }", "SELECT ?s WHERE { ?s <https://schema.org/url> ?o } LIMIT 0",
    "SELECT ?s WHERE { ?s <https://schema.org/url> ?o } LIMIT 10 OFFSET 99999999"]) {
    assert.throws(() => assertReadSparql(query));
  }
});
