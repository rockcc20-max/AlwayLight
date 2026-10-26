import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const file of ['background.js', 'lib/controller.js', 'lib/state.js', 'popup.js', 'scripts/package.mjs', 'dev/server.mjs', 'dev/mock-chrome.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || `语法检查失败：${file}`);
}
for (const file of new Set([manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), 'popup.js', 'popup.css', 'assets/icon.svg'])) {
  await access(path.join(root, file));
}
console.log('JavaScript 语法及所有扩展资源检查通过。');
