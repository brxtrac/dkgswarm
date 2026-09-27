#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const PATH = process.env.DKG_MCP_WRITER_CODES || "/root/dkg-public-mcp/writer-codes.json";

const HELP = `Usage:
  node issue-writer-code.mjs add [--count N] [--memo TEXT]
  node issue-writer-code.mjs list [--show-codes]
  node issue-writer-code.mjs remove <code|index|unused:index|used:index>
  node issue-writer-code.mjs memo <code|index|unused:index|used:index> <text>
  node issue-writer-code.mjs clear-unused
  node issue-writer-code.mjs stats
  node issue-writer-code.mjs help

Default command: add

Environment:
  DKG_MCP_WRITER_CODES  Path to writer-codes.json
`;

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "add";

function readDb() {
  let db = { unused: [], used: [] };
  if (fs.existsSync(PATH)) {
    db = JSON.parse(fs.readFileSync(PATH, "utf8"));
  }
  db.unused = Array.isArray(db.unused) ? db.unused : [];
  db.used = Array.isArray(db.used) ? db.used : [];
  return db;
}

function writeJsonAtomic(filePath, db) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function writeDb(db) {
  writeJsonAtomic(PATH, db);
}

function withFileLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  let lock;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.unlinkSync(lockPath);
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (lock === undefined) fail("writer-code registry is busy");
  try {
    return operation();
  } finally {
    fs.closeSync(lock);
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

function optionValue(name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) fail(`${name} requires value`);
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function maskCode(code) {
  if (!code || code.length <= 8) return "********";
  return `${code.slice(0, 4)}...${code.slice(-4)}`;
}

function printStats(db) {
  console.log(`unused=${db.unused.length} used=${db.used.length}`);
}

function locateCode(db, target) {
  let pool;
  let idx;
  const qualified = /^(unused|used):(\d+)$/.exec(target);
  if (qualified) {
    pool = qualified[1];
    idx = Number(qualified[2]) - 1;
  } else if (/^\d+$/.test(target)) {
    idx = Number(target) - 1;
    pool = idx < db.unused.length ? "unused" : "used";
  } else {
    idx = db.unused.findIndex((row) => row && row.code === target);
    pool = "unused";
    if (idx === -1) {
      idx = db.used.findIndex((row) => row && row.code === target);
      pool = "used";
    }
  }
  if (idx < 0 || idx >= db[pool].length) fail("writer code not found");
  return { pool, idx };
}

function addCodes() {
  const count = Number(optionValue("--count", "1"));
  if (!Number.isInteger(count) || count < 1) fail("--count must be positive integer");
  const memo = optionValue("--memo", "").trim();

  const { db, created } = withFileLock(PATH, () => {
    const db = readDb();
    const created = [];
    for (let i = 0; i < count; i += 1) {
      const row = {
        code: crypto.randomBytes(12).toString("base64url"),
        createdAt: new Date().toISOString(),
        ...(memo ? { memo } : {}),
      };
      db.unused.push(row);
      created.push(row.code);
    }
    writeDb(db);
    return { db, created };
  });
  console.log(created.join("\n"));
  printStats(db);
}

function listCodes() {
  const db = readDb();
  const showCodes = hasFlag("--show-codes");
  if (!db.unused.length && !db.used.length) {
    console.log("No writer codes found.");
    return;
  }

  console.log("Unused:");
  db.unused.forEach((row, idx) => {
    const code = showCodes ? row.code : maskCode(row.code);
    const memo = row.memo ? ` memo=${JSON.stringify(row.memo)}` : "";
    console.log(`  unused:${idx + 1} ${code}${memo} createdAt=${row.createdAt || "unknown"}`);
  });
  if (!db.unused.length) console.log("  none");

  console.log("Used:");
  db.used.forEach((row, idx) => {
    const code = showCodes ? row.code : maskCode(row.code);
    const memo = row.memo ? ` memo=${JSON.stringify(row.memo)}` : "";
    console.log(`  used:${idx + 1} ${code}${memo} createdAt=${row.createdAt || "unknown"} usedAt=${row.usedAt || "unknown"}`);
  });
  if (!db.used.length) console.log("  none");
}

function removeCode() {
  const target = args[0];
  if (!target) fail("remove requires code or index");
  const result = withFileLock(PATH, () => {
    const db = readDb();
    const { pool, idx } = locateCode(db, target);
    const [removed] = db[pool].splice(idx, 1);
    const revokedLegacy = pool === "used" && !removed.grantId;
    if (revokedLegacy) db.legacyWriterRevoked = true;
    writeDb(db);
    return { db, pool, removed, revokedLegacy };
  });
  const { db, pool, removed, revokedLegacy } = result;
  console.log(`removed=${maskCode(removed.code)} status=${pool}`);
  if (pool === "used") {
    console.log("writer_access=revoked");
    if (revokedLegacy) console.log("warning=revoked all unlinked legacy writer credentials");
  }
  printStats(db);
}

function setMemo() {
  const target = args.shift();
  const memo = args.join(" ").trim();
  if (!target) fail("memo requires code or index");
  if (!memo) fail("memo requires text");

  const result = withFileLock(PATH, () => {
    const db = readDb();
    const { pool, idx } = locateCode(db, target);
    db[pool][idx].memo = memo;
    writeDb(db);
    return { db, pool, code: db[pool][idx].code };
  });
  console.log(`updated=${maskCode(result.code)} status=${result.pool} memo=${JSON.stringify(memo)}`);
  printStats(result.db);
}

function clearUnused() {
  const { db, removed } = withFileLock(PATH, () => {
    const db = readDb();
    const removed = db.unused.length;
    db.unused = [];
    writeDb(db);
    return { db, removed };
  });
  console.log(`removed=${removed}`);
  printStats(db);
}

switch (command) {
  case "add":
    addCodes();
    break;
  case "list":
    listCodes();
    break;
  case "remove":
    removeCode();
    break;
  case "memo":
    setMemo();
    break;
  case "clear-unused":
    clearUnused();
    break;
  case "stats":
    printStats(readDb());
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    fail(`Unknown command: ${command}\n\n${HELP}`);
}
