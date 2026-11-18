// Banco de física en Chrome/Chromium headless: sirve dist/ y abre /jolt/?banco=1, espera window.__res.
// Uso: node lab/jolt/banco.mjs <carpeta-dist> <salida.json> [segundos]   (CHROME=/ruta/al/navegador para cambiarlo)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
const [dist, salida, seg = '60'] = process.argv.slice(2);
const APP = 9330, CDP = 9331, WIN = process.platform === 'win32';
const CHROME = process.env.CHROME || (WIN ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
const srv = createServer(async (q, r) => {
    try { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); const f = join(dist, p.endsWith('/') ? p + 'index.html' : p);
        const b = await readFile(f); r.writeHead(200, { 'content-type': tipos[extname(f)] || 'application/octet-stream' }); r.end(b); } catch { if (!r.headersSent) r.writeHead(404); r.end(); }
}).listen(APP);
const perfil = join(tmpdir(), 'qdtm-jolt-perfil'); await mkdir(perfil, { recursive: true });
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${perfil}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const dormir = ms => new Promise(r => setTimeout(r, ms));
let lista; for (let i = 0; i < 40 && !lista; i++) { await dormir(500); try { lista = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { } }
const pg = lista.find(t => t.type === 'page'); const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Page.navigate', { url: `http://127.0.0.1:${APP}/jolt/?banco=1&s=${seg}` });
let res = null; const t0 = Date.now();
while (!res && Date.now() - t0 < 900000) { await dormir(2000); const m = await cdp('Runtime.evaluate', { expression: 'JSON.stringify(window.__res||null)', returnByValue: true }); const v = m.result?.result?.value; if (v && v !== 'null') res = JSON.parse(v); }
await writeFile(salida, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res));
ws.close(); srv.close();
if (WIN) spawn('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); else ch.kill();
setTimeout(() => process.exit(0), 1500);
