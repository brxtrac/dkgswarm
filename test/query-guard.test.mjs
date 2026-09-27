import test from "node:test";
import assert from "node:assert/strict";
import { assertReadSparql } from "../query-guard.mjs";

test("read queries require bounded results and reject federated or write operations", () => {
  assert.equal(assertReadSparql("SELECT ?s WHERE { ?s ?p ?o } LIMIT 50"), "SELECT ?s WHERE { ?s ?p ?o } LIMIT 50");
  assert.equal(assertReadSparql("ASK { ?s ?p ?o }"), "ASK { ?s ?p ?o }");
  for (const query of ["SELECT ?s WHERE { ?s ?p ?o }", "SELECT ?s WHERE { ?s ?p ?o } LIMIT 101",
    "SELECT ?s WHERE { SERVICE <http://localhost:9200> { ?s ?p ?o } } LIMIT 10",
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }", "DELETE WHERE { ?s ?p ?o }", "SELECT ?s WHERE { ?s ?p ?o } LIMIT 0",
    "SELECT ?s WHERE { ?s ?p ?o } LIMIT 10 OFFSET 99999999"]) {
    assert.throws(() => assertReadSparql(query));
  }
});
