// Touch + pen input through Chrome DevTools Protocol (real touch points, pen with pressure):
// finger drawing, pinch zoom, two-finger tap = undo, pen pressure, palm rejection after a pen was used, UI sliders by finger.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8395'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; };
try {
  await sleep(400);
  console.log('\n== touch + pen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('dd.profile', JSON.stringify({ id: 'touch001', name: 'Tess', color: '#22b88f' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [page error]', e.message); failures++; });
  await page.goto('http://localhost:8395/');
  await page.waitForFunction(() => window.app && window.app.doc);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const scr = (x, y) => page.evaluate(([a, c]) => window.app.view.toScreen(a, c), [x, y]);
  const ops = () => page.evaluate(() => window.app.doc.opCount);

  // one finger draws
  let [x0, y0] = await scr(300, 300), [x1, y1] = await scr(900, 700);
  await touch('touchStart', [[x0, y0]]);
  for (let i = 1; i <= 15; i++) { await touch('touchMove', [[x0 + ((x1 - x0) * i) / 15, y0 + ((y1 - y0) * i) / 15]]); await sleep(8); }
  await touch('touchEnd', []);
  await sleep(150);
  ok((await ops()) === 1, 'a finger draws a stroke');

  // pinch zoom with two fingers: no stroke, zoom changes
  const s0 = await page.evaluate(() => window.app.view.s);
  const c = [590, 420];
  await touch('touchStart', [[c[0] - 60, c[1]], [c[0] + 60, c[1]]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[c[0] - 60 - i * 12, c[1]], [c[0] + 60 + i * 12, c[1]]]); await sleep(10); }
  await touch('touchEnd', []);
  await sleep(150);
  const s1 = await page.evaluate(() => window.app.view.s);
  ok(s1 > s0 * 1.6 && (await ops()) === 1, `pinch zooms in (×${(s1 / s0).toFixed(2)}) without drawing`);

  // two-finger tap = undo
  await touch('touchStart', [[500, 400], [600, 420]]);
  await sleep(60);
  await touch('touchEnd', []);
  await sleep(150);
  ok(await page.evaluate(() => [...window.app.doc.ops.values()][0].u === 1), 'two-finger tap undoes');
  await touch('touchStart', [[500, 400], [600, 420], [700, 420]]);
  await sleep(60);
  await touch('touchEnd', []);
  await sleep(150);
  ok(await page.evaluate(() => !([...window.app.doc.ops.values()][0].u)), 'three-finger tap redoes');
  await page.evaluate(() => window.app.view.fit());

  // Apple Pencil style pen with pressure
  [x0, y0] = await scr(300, 1000); [x1, y1] = await scr(1300, 1000);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.1 });
  for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 20, y: y0, button: 'left', buttons: 1, pointerType: 'pen', force: 0.1 + 0.85 * Math.sin((i / 20) * Math.PI) }); await sleep(8); }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y0, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  await sleep(150);
  const pr = await page.evaluate(() => { const o = [...window.app.doc.ops.values()].sort((a, b) => a.k - b.k).pop(); const p = []; for (let i = 2; i < o.p.length; i += 3) p.push(o.p[i]); return [Math.min(...p), Math.max(...p)]; });
  ok((await ops()) === 2 && pr[1] - pr[0] > 0.4, `pen pressure varies the stroke (pressure ${pr[0]}–${pr[1]})`);

  // after the pen was used, a resting palm / finger must not draw (it moves the canvas instead)
  const tx0 = await page.evaluate(() => window.app.view.tx);
  [x0, y0] = await scr(300, 1300);
  await touch('touchStart', [[x0, y0]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[x0 + i * 15, y0]]); await sleep(8); }
  await touch('touchEnd', []);
  await sleep(150);
  const tx1 = await page.evaluate(() => window.app.view.tx);
  ok((await ops()) === 2 && Math.abs(tx1 - tx0) > 50, 'with a pen in use, fingers pan instead of drawing (palm rejection)');

  // the size slider works by finger
  const z0 = await page.evaluate(() => window.app.bsOf('pen').z);
  const tr = await page.evaluate(() => { const r = document.querySelector('#sliders .track').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 8]; });
  await touch('touchStart', [tr]); await touch('touchMove', [[tr[0], tr[1] + 2]]); await touch('touchEnd', []);
  await sleep(100);
  const z1 = await page.evaluate(() => window.app.bsOf('pen').z);
  ok(z1 > z0 * 2, `size slider responds to touch (${Math.round(z0)} → ${Math.round(z1)} px)`);

  // dock buttons work by tap
  await page.touchscreen.tap(...(await page.evaluate(() => { const r = document.querySelector('.tool[aria-label="Fill"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })));
  ok((await page.evaluate(() => window.app.tool)) === 'fill', 'tapping a tool selects it');
  await b.close();
} catch (e) { console.log('  ✗ crashed:', e); failures++; }
server.kill();
console.log(failures ? `\n${failures} problem(s)` : '\nall good');
process.exit(failures ? 1 : 0);
