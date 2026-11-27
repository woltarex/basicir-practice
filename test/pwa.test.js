import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

test('manifest parses and names the app', () => {
  const m = JSON.parse(readFileSync('manifest.json', 'utf8'));
  assert.equal(m.name, 'IR Drill');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.every((i) => existsSync(i.src)));
});

test('service worker precaches every app file, and only files that exist', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const files = JSON.parse(sw.match(/const FILES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  for (const f of files) if (f !== './') assert.ok(existsSync(f), `missing ${f}`);
  const js = [...readdirSync('.').filter((f) => f.endsWith('.js') && f !== 'sw.js'),
    ...readdirSync('instruments').map((f) => `instruments/${f}`)];
  for (const f of [...js, 'index.html', 'manifest.json', 'icon.svg']) assert.ok(files.includes(f), `not precached: ${f}`);
});
