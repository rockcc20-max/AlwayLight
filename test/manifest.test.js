import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const load = (file) => readFile(new URL(file, root));

test('installable MV3 manifest declares only the three local keep-awake permissions', async () => {
  const manifest = JSON.parse(await load('manifest.json'));
  assert.equal(manifest.name, 'AlwayLight');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.deepEqual(manifest.permissions.toSorted(), ['alarms','power','storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = await load(file);
    assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.action.default_icon)]) assert.ok((await load(file)).length);
});

test('production popup loads local resources and never includes the development power mock', async () => {
  const html = String(await load('popup.html'));
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (ref.startsWith('#')) continue;
    assert.doesNotMatch(ref, /^(https?:|\/\/)|mock|demo|dev\//);
    assert.ok((await load(ref)).length, ref);
  }
  assert.match(html, /name="mode" value="display"/);
  assert.match(html, /name="mode" value="system"/);
  assert.match(html, /name="mode" value="default"/);
});
