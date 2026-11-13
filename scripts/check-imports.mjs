import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Host-provided optional integrations are reported, not treated as missing.
const OPTIONAL = new Set(['viem']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'site', 'data', 'coverage', '.opencode', 'test']);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(directory, entry.name), files);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

export function extractSpecifiers(source) {
  const found = new Set();
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

export function findMissing(root = process.cwd()) {
  const base = path.resolve(root);
  const missing = [];
  const warnings = [];
  const files = walk(base);
  for (const file of files) {
    for (const specifier of extractSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('node:')) continue;
      try {
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          const target = fileURLToPath(new URL(specifier, pathToFileURL(file)));
          if (!fs.existsSync(target)) throw new Error('missing file');
        } else if (specifier.startsWith('file:')) {
          if (!fs.existsSync(fileURLToPath(specifier))) throw new Error('missing file');
        } else {
          // Resolve bare packages from the importing file, so per-service node_modules are checked.
          // shortcut: createRequire covers current CJS/dual packages; add an import-only
          // resolver here if a dependency ships only an "import" export condition.
          createRequire(file).resolve(specifier);
        }
      } catch {
        const record = { file: path.relative(base, file), specifier };
        if (OPTIONAL.has(specifier)) warnings.push(record);
        else missing.push(record);
      }
    }
  }
  return { files: files.length, missing, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || process.cwd());
  const { files, missing, warnings } = findMissing(root);
  for (const warning of warnings) {
    console.warn(`optional import not installed: ${warning.specifier} (${warning.file})`);
  }
  if (missing.length) {
    for (const item of missing) console.error(`missing import: ${item.specifier} (${item.file})`);
    process.exitCode = 1;
  } else {
    console.log(`imports ok: ${files} files under ${root}`);
  }
}
