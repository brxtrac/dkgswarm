import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpecifiers, findMissing } from '../scripts/check-imports.mjs';

test('extracts static, side-effect and dynamic import specifiers', () => {
  const specs = extractSpecifiers(`
    import fs from 'node:fs';
    import './side-effect.mjs';
    export { x } from './re-export.mjs';
    const later = await import('./dynamic.mjs');
  `);
  assert.deepEqual(specs.sort(), ['./dynamic.mjs', './re-export.mjs', './side-effect.mjs', 'node:fs'].sort());
});

test('fails on missing relative and package imports but tolerates optional viem', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'import-check-'));
  try {
    writeFileSync(`${root}/dep.mjs`, 'export const x = 1;\n');
    writeFileSync(`${root}/good.mjs`, `import './dep.mjs';\nimport fs from 'node:fs';\n`);
    writeFileSync(`${root}/bad.mjs`, `import './nope.mjs';\nimport 'definitely-not-installed-pkg';\nconst later = await import('./nope.mjs');\n`);
    writeFileSync(`${root}/optional.mjs`, `const viem = await import('viem');\n`);
    const result = findMissing(root);
    assert.deepEqual(result.missing.map((item) => item.specifier).sort(), ['./nope.mjs', 'definitely-not-installed-pkg']);
    assert.deepEqual(result.warnings.map((item) => item.specifier), ['viem']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates the configured viem integration by actual runtime import', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'viem-check-'));
  try {
    mkdirSync(`${root}/collector`, { recursive: true });
    writeFileSync(`${root}/collector/network-stats.mjs`, `const moduleName = process.env.TRAC_VIEM_MODULE || 'viem';
export async function loadViem() { return import(moduleName); }
`);
    const env = { ...process.env, TRAC_VIEM_MODULE: '' };
    const absent = findMissing(root, env);
    assert.deepEqual(absent.missing, []);
    assert.deepEqual(absent.warnings.map((item) => item.specifier), ['viem']);

    const fixture = `${root}/fake-viem.mjs`;
    writeFileSync(fixture, 'export const ready = true;\n');
    const file = findMissing(root, { ...env, TRAC_VIEM_MODULE: fixture });
    assert.deepEqual(file.missing, []);
    assert.deepEqual(file.warnings, []);

    mkdirSync(`${root}/collector/node_modules/viem`, { recursive: true });
    writeFileSync(`${root}/collector/node_modules/viem/package.json`, JSON.stringify({ name: 'viem', version: '0.0.0', type: 'module', exports: './index.js' }));
    writeFileSync(`${root}/collector/node_modules/viem/index.js`, 'export const ready = true;\n');
    const pkg = findMissing(root, { ...env, TRAC_VIEM_MODULE: 'viem' });
    assert.deepEqual(pkg.missing, []);
    assert.deepEqual(pkg.warnings, []);

    const badFile = findMissing(root, { ...env, TRAC_VIEM_MODULE: `${root}/missing-viem.mjs` });
    assert.deepEqual(badFile.missing.map((item) => item.specifier), [`${root}/missing-viem.mjs`]);
    const badPkg = findMissing(root, { ...env, TRAC_VIEM_MODULE: 'not-a-real-viem-package' });
    assert.deepEqual(badPkg.missing.map((item) => item.specifier), ['not-a-real-viem-package']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('this checkout resolves every tracked source import', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = findMissing(root);
  assert.deepEqual(result.missing, []);
});
