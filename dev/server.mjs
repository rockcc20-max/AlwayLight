import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const previewShell = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AlwayLight · 界面预览</title><style>body{margin:0;min-height:100vh;background:#ecece4;display:grid;place-content:center;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#777e69;gap:18px}.caption{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.5px}.caption b{font-weight:500;color:#7b806e}iframe{width:360px;height:600px;border:0;border-radius:18px;box-shadow:0 15px 50px #45493316,0 0 0 1px #dddccf}p{margin:0;text-align:center;font-size:10px;color:#939987}</style><div class="caption"><b>AlwayLight</b><span>INTERACTIVE PREVIEW / 01</span></div><iframe title="插件界面预览" src="/demo-popup"></iframe><p>交互演示 · 不会改变电脑电源设置</p></html>`;

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname === '/preview') {
      response.writeHead(200, {'Content-Type':mime['.html'],'Cache-Control':'no-store'});
      response.end(previewShell);
      return;
    }
    if (pathname === '/demo-popup') {
      const html = (await readFile(path.join(root, 'popup.html'),'utf8')).replace('<script src="popup.js"', '<script src="/dev/mock-chrome.js"></script><script src="popup.js"');
      response.writeHead(200, {'Content-Type':mime['.html'],'Cache-Control':'no-store'});
      response.end(html);
      return;
    }
    const relative = pathname.replace(/^\/+/, '');
    if (!['popup.html','popup.js','popup.css','dev/mock-chrome.js','docs/alwaylight-preview.png','docs/chrome-web-store/artboards.html'].includes(relative) && !/^assets\/icon(?:-\d+\.png|\.svg)$/.test(relative) && !/^docs\/chrome-web-store\/popup-(display|system|timer)\.(png|jpg)$/.test(relative)) {
      response.writeHead(404);response.end('Not found');return;
    }
    const data = await readFile(path.join(root,relative));
    response.writeHead(200, {'Content-Type':mime[path.extname(relative)] || 'application/octet-stream','Cache-Control':'no-store'});
    response.end(data);
  } catch {
    response.writeHead(404);response.end('Not found');
  }
}).listen(4175,'127.0.0.1',() => console.log('交互预览：http://127.0.0.1:4175（演示状态，不控制系统电源）'));
