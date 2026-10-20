// Screenshots of key screens at Mac / iPad / phone sizes for a visual check. Usage: node tools/shots.mjs <outdir> [engine]
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = process.argv[2] || '/tmp', eng = { chromium, webkit }[process.argv[3] || 'webkit'];
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8393'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const b = await eng.launch();
const SIZES = { mac: { width: 1440, height: 900 }, ipad: { width: 1180, height: 820, isMobile: false, hasTouch: true }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
async function open(size) {
  const ctx = await b.newContext({ viewport: { width: SIZES[size].width, height: SIZES[size].height }, deviceScaleFactor: 2, hasTouch: !!SIZES[size].hasTouch, isMobile: eng === chromium && !!SIZES[size].isMobile, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('dd.profile', JSON.stringify({ id: 'shot0001', name: 'Dhairya', color: '#3d9bff' })));
  const p = await ctx.newPage();
  await p.goto('http://localhost:8393/'); await p.waitForFunction(() => window.app && window.app.doc);
  await p.evaluate(() => {
    const a = window.app, d = a.doc, L = d.layerList()[0].id, cols = ['#ff5f9e', '#3d9bff', '#ffb020', '#22b88f', '#7a5ac8'];
    for (let k = 0; k < 8; k++) { const pts = []; for (let i = 0; i <= 50; i++) { const t = (i / 50) * 6.283, r = 140 + k * 55; pts.push(800 + Math.cos(t) * r, 800 + Math.sin(t) * r * 0.8, 0.5 + 0.5 * Math.sin(t * 2)); } d.commit({ id: 'r' + k, a: a.me.id, k: d.nextK(), t: 's', l: L, b: ['pen', 'water', 'crayon', 'marker', 'neon', 'pencil', 'callig', 'brush'][k], c: cols[k % 5], z: 10 + k * 3, o: 0.9, sd: k + 1, p: pts }); }
    a.view.request();
  });
  await p.waitForTimeout(400);
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });
for (const size of ['mac', 'ipad', 'phone']) {
  const p = await open(size);
  await shot(p, size + '-main');
  await p.evaluate(() => window.app.modes.start('split', {})); await p.waitForTimeout(200); await shot(p, size + '-split');
  await p.evaluate(() => window.app.openModes()); await p.waitForTimeout(300); await shot(p, size + '-modes');
  await p.keyboard.press('Escape');
  if (size === 'phone') { await p.evaluate(() => window.app.toggleIdeas()); await p.waitForTimeout(300); await shot(p, size + '-ideas'); await p.keyboard.press('Escape'); }
  await p.evaluate(() => window.app.ideas.openCard('lib:cat-steps')); await p.waitForTimeout(300); await shot(p, size + '-card');
  await p.evaluate(() => { window.app.ideas.closeAll(); document.querySelector('.who').click(); }); await p.waitForTimeout(300); await shot(p, size + '-invite');
  await p.keyboard.press('Escape');
  await p.close();
}
const p = await open('mac');
await p.evaluate(async () => { const m = await import('./js/replay.js'); m.openReplay(window.app); });
await p.waitForTimeout(3500); await shot(p, 'mac-replay');
await b.close(); server.kill();
console.log('shots in ' + out);
