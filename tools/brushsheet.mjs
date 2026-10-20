// Contact sheet of every brush (a wavy pressure stroke each). Usage: node tools/brushsheet.mjs out.png [engine]
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8397'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const b = await ({ chromium, webkit }[process.argv[3] || 'chromium']).launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.goto('http://localhost:8397/manifest.webmanifest');
await p.setContent('<body style="margin:0;background:#ddd"><canvas id=c></canvas></body>');
await p.addScriptTag({ type: 'module', content: `
  import { BRUSHES, StrokeRenderer, compositeStroke, bbRect } from 'http://localhost:8397/js/brushes.js';
  const cols = 4, cw = 370, ch = 92, rows = Math.ceil(BRUSHES.length / cols);
  const c = document.getElementById('c'); c.width = cols * cw; c.height = rows * ch; const x = c.getContext('2d');
  const palette = ['#e5484d', '#3d8bff', '#22b88f', '#7a5ac8', '#ff7a45', '#2f2940'];
  BRUSHES.forEach((B, i) => {
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch, dark = B.blend === 'lighter';
    x.fillStyle = dark ? '#1d1a28' : '#ffffff'; x.fillRect(ox + 2, oy + 2, cw - 4, ch - 4);
    if (B.erase) { x.fillStyle = '#c9c3d3'; x.fillRect(ox + 2, oy + 30, cw - 4, 34); }
    const s = document.createElement('canvas'); s.width = c.width; s.height = c.height; const sx = s.getContext('2d');
    const pts = []; for (let k = 0; k <= 60; k++) { const t = k / 60; pts.push(ox + 20 + t * (cw - 40), oy + 50 + Math.sin(t * 6.28) * 18, 0.25 + 0.75 * Math.sin(Math.PI * t)); }
    const op = { b: B.id, c: palette[i % palette.length], z: Math.min(B.def.z, 24), o: B.def.o, sd: 7 + i, p: pts };
    const r = new StrokeRenderer(op, sx); r.add(pts); r.finish();
    compositeStroke(x, op, s, bbRect(r.bb, s.width, s.height));
    x.fillStyle = dark ? '#fff' : '#333'; x.font = 'bold 13px sans-serif'; x.fillText(B.cat + ' · ' + B.name, ox + 8, oy + 18);
  });
  window.done = true;` });
await p.waitForFunction(() => window.done);
await p.locator('#c').screenshot({ path: process.argv[2] });
await b.close(); server.kill();
