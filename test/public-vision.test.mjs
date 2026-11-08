import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const publicCopy = ['README.md', 'site/index.html', 'site/contexts.html', 'site/llms.txt'];

test('public copy describes an owner-approved move, not a completed transfer', () => {
  for (const file of publicCopy) {
    const text = read(file);
    assert.match(text, /OpenDKG/, file);
    assert.match(text, /transfer/i, file);
    assert.doesNotMatch(text, /(?:repository|repo|project) is (?:now )?OpenDKG-owned|owned by OpenDKG|transferred to OpenDKG|OpenDKG has endorsed|official OpenDKG (?:project|marketing)/i, file);
  }
});

test('public vision preserves the existing mission and permission boundaries', () => {
  const readme = read('README.md');
  for (const term of ['OriginTrail', 'TRAC', 'Umanitek']) assert.match(readme, new RegExp(term), 'README');

  const index = read('site/index.html');
  assert.match(index, /OriginTrail/i);
  assert.match(index, /Umanitek/i);
  assert.match(index, /opt-in/i);
  assert.doesNotMatch(index, /autonomous posting (?:is|will be) (?:enabled|active)/i);

  assert.match(read('site/llms.txt'), /trac-marketing[\s\S]*only live (?:context|graph)/i);
});

test('OpenDKG references point to the public organization and local proposal docs', () => {
  for (const file of ['README.md', 'site/index.html', 'site/contexts.html']) {
    assert.match(read(file), /https:\/\/github\.com\/OpenDKG/, file);
  }
  assert.equal(fs.existsSync(new URL('docs/opendkg-umbrella.md', root)), true);
  assert.match(read('README.md'), /docs\/opendkg-umbrella\.md/);
});

test('project license is declared consistently as MIT with a root LICENSE', () => {
  const license = read('LICENSE');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2025 BRX/);
  for (const file of ['package.json', 'collector/package.json']) {
    assert.equal(JSON.parse(read(file)).license, 'MIT', file);
  }
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, 'MIT');
  assert.equal(JSON.parse(read('collector/package-lock.json')).packages[''].license, 'MIT');
});

test('third-party notices preserve the PR #1 ISC basis', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(read('README.md'), /THIRD_PARTY_NOTICES\.md/);
  assert.match(notices, /https:\/\/github\.com\/brxtrac\/dkgswarm\/pull\/1/);
  assert.match(notices, /87059a5b38e9f693121009d2b21f43b652b7b3f8/);
  assert.match(notices, /DeFine/);
  for (const file of ['activity.mjs', 'server.mjs', 'test/activity.test.mjs']) {
    assert.ok(notices.includes(file), file);
  }
  assert.match(notices, /ISC/);
  assert.match(notices, /does not relicense/);
});
