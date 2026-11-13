import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

test('this checkout resolves every tracked source import', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = findMissing(root);
  assert.deepEqual(result.missing, []);
});
