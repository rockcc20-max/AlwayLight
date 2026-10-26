import { readFile, mkdir, copyFile, readdir, lstat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('版本号格式错误');
const name = `alwaylight-${manifest.version}`;
const output = path.join(root, 'dist', name);
const zipPath = path.join(root, 'dist', `${name}.zip`);
// A strict runtime allowlist keeps preview mocks, tests and local files out of
// both the unpacked build and the Chrome Web Store package.
const files = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'PRIVACY.md', 'LICENSE'];
for (const folder of ['lib', 'assets']) {
  for (const entry of (await readdir(path.join(root, folder))).sort()) {
    if ((folder === 'lib' && entry.endsWith('.js')) || (folder === 'assets' && /\.(png|svg)$/.test(entry))) files.push(`${folder}/${entry}`);
  }
}
await mkdir(path.join(root, 'dist'), {recursive:true});
await rm(output, {recursive:true, force:true});
await rm(zipPath, {force:true});
await mkdir(output, {recursive:true});
for (const file of files) {
  const source = path.join(root, file);
  if (!(await lstat(source)).isFile()) throw new Error(`拒绝打包非普通文件：${file}`);
  await mkdir(path.dirname(path.join(output, file)), {recursive:true});
  await copyFile(source, path.join(output, file));
}
const archive = spawnSync('zip', ['-q', '-X', zipPath, ...files], {cwd:output,encoding:'utf8'});
if (archive.status !== 0) throw new Error(archive.stderr || 'ZIP 打包失败');
const check = spawnSync('unzip', ['-t', zipPath], {encoding:'utf8'});
if (check.status !== 0) throw new Error(check.stdout || check.stderr || 'ZIP 校验失败');
console.log(`已生成可加载文件夹：${output}`);
console.log(`已生成安装包：${zipPath}`);
