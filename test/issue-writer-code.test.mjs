import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("issue-writer-code.mjs");

function grantId(code) {
  return crypto.createHash("sha256").update(`writer-code:${code}`).digest("hex");
}

function fixture({ writer }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writer-code-test-"));
  const writerPath = path.join(dir, "writer-codes.json");
  fs.writeFileSync(writerPath, JSON.stringify(writer));
  return {
    dir,
    writerPath,
    run(...args) {
      return execFileSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: { ...process.env, DKG_MCP_WRITER_CODES: writerPath },
      });
    },
  };
}

test("removing a used code revokes its writer grant", (t) => {
  const removedCode = "removed-writer-code";
  const keptCode = "kept-writer-code";
  const f = fixture({
    writer: {
      unused: [],
      used: [
        { code: removedCode, grantId: grantId(removedCode), usedAt: "2026-09-20T00:00:00.000Z" },
        { code: keptCode, grantId: grantId(keptCode), usedAt: "2026-09-20T00:00:00.000Z" },
      ],
    },
  });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  const output = f.run("remove", removedCode);
  const writer = JSON.parse(fs.readFileSync(f.writerPath, "utf8"));

  assert.match(output, /status=used/);
  assert.match(output, /writer_access=revoked/);
  assert.deepEqual(writer.used.map((row) => row.code), [keptCode]);
});

test("used:index revokes legacy writer credentials", (t) => {
  const f = fixture({
    writer: { unused: [{ code: "unused" }], used: [{ code: "legacy-used" }] },
  });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  const output = f.run("remove", "used:1");
  const writer = JSON.parse(fs.readFileSync(f.writerPath, "utf8"));

  assert.match(output, /warning=revoked all unlinked legacy writer credentials/);
  assert.equal(writer.unused.length, 1);
  assert.equal(writer.used.length, 0);
  assert.equal(writer.legacyWriterRevoked, true);
});

test("plain numeric index keeps unused-first compatibility", (t) => {
  const f = fixture({
    writer: { unused: [{ code: "first-unused" }], used: [{ code: "first-used" }] },
  });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  const output = f.run("remove", "1");
  const writer = JSON.parse(fs.readFileSync(f.writerPath, "utf8"));

  assert.match(output, /status=unused/);
  assert.equal(writer.unused.length, 0);
  assert.equal(writer.used.length, 1);
});

test("add stores memo on new codes", (t) => {
  const f = fixture({ writer: { unused: [], used: [] } });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  f.run("add", "--count", "2", "--memo", "Alice team");
  const writer = JSON.parse(fs.readFileSync(f.writerPath, "utf8"));

  assert.equal(writer.unused.length, 2);
  assert.deepEqual(writer.unused.map((row) => row.memo), ["Alice team", "Alice team"]);
});

test("memo adds or renames memo on unused and used codes", (t) => {
  const f = fixture({
    writer: {
      unused: [{ code: "unused-code" }],
      used: [{ code: "used-code", memo: "Old name", grantId: grantId("used-code") }],
    },
  });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  f.run("memo", "unused:1", "Alice");
  const output = f.run("memo", "used:1", "Bob renamed");
  const writer = JSON.parse(fs.readFileSync(f.writerPath, "utf8"));

  assert.equal(writer.unused[0].memo, "Alice");
  assert.equal(writer.used[0].memo, "Bob renamed");
  assert.match(output, /memo="Bob renamed"/);
});

test("list displays memo while keeping codes masked", (t) => {
  const f = fixture({
    writer: { unused: [{ code: "long-secret-code", memo: "Alice" }], used: [] },
  });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  const output = f.run("list");

  assert.match(output, /unused:1 long\.\.\.code memo="Alice"/);
  assert.doesNotMatch(output, /long-secret-code/);
});
