// Contact sheet of every built-in inspiration picture. Usage: node tools/artsheet.mjs out.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8394'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:8394/manifest.webmanifest');
await p.setContent('<body style="margin:0;background:#eee;font-family:sans-serif"><div id=g style="display:grid;grid-template-columns:repeat(9,150px);gap:6px;padding:6px"></div></body>');
await p.addScriptTag({ type: 'module', content: `
  import { CATEGORIES, itemsIn, svgUrl } from 'http://localhost:8394/js/library.js';
  const g = document.getElementById('g');
  for (const c of CATEGORIES) for (const it of itemsIn(c)) if (it.svg) { const d = document.createElement('div'); d.style.cssText='background:#fff;font-size:11px;text-align:center'; d.innerHTML = '<img width=150 height=150 src="' + svgUrl(it.svg) + '"><br>' + c + ': ' + it.name; g.append(d); }
  window.done = true;` });
await p.waitForFunction(() => window.done); await p.waitForTimeout(800);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close(); server.kill();
