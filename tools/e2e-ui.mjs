// Presses the real buttons of the picture cards (and a few other controls) with a mouse and with touch taps, in
// Chromium and WebKit: open a picture from the rail, Trace → Whole page, Colours → pick one, drag the card, close it.
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8396'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; };

async function run(engine, touch) {
  console.log(`\n== picture cards: ${engine.name()} ${touch ? 'touch' : 'mouse'}`);
  const b = await engine.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, hasTouch: touch, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('dd.profile', JSON.stringify({ id: 'uitest01', name: 'Uma', color: '#ff5f9e' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [page error]', e.message); failures++; });
  await page.goto('http://localhost:8396/');
  await page.waitForFunction(() => window.app && window.app.doc && window.app.ideas);
  const press = async (loc) => { if (touch) await loc.tap(); else await loc.click(); await sleep(150); };

  await press(page.locator('.rail.left .thumb').first());
  const card = page.locator('.refcard').first();
  ok(await card.isVisible(), 'tapping a picture in the rail opens its card');

  await press(card.getByRole('button', { name: 'Trace' }));
  ok(await page.locator('#pop').isVisible(), 'Trace opens the "Trace where?" menu');
  await press(page.locator('#pop').getByRole('button', { name: 'Whole page' }));
  ok(await page.evaluate(() => window.app.doc.refs.list.length === 1), 'choosing "Whole page" traces the picture onto the canvas');

  const before = await page.evaluate(() => window.app.settings.color);
  await press(card.getByRole('button', { name: 'Colours' }));
  ok(await page.locator('#pop .sws button').first().isVisible(), 'Colours shows the colours of the picture');
  await press(page.locator('#pop .sws button').nth(1));
  const after = await page.evaluate(() => window.app.settings.color);
  ok(after !== before, `picking one sets the brush colour (${before} → ${after})`);

  const box0 = await card.boundingBox();
  const head = card.locator('.rh .grow');
  const hb = await head.boundingBox();
  if (touch) {
    const cdp = engine === chromium ? await ctx.newCDPSession(page) : null;
    if (cdp) {
      const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0 }] });
      await t('touchStart', hb.x + 20, hb.y + 10);
      for (let i = 1; i <= 6; i++) await t('touchMove', hb.x + 20 - i * 25, hb.y + 10 + i * 10);
      await t('touchEnd');
    }
  } else {
    await page.mouse.move(hb.x + 20, hb.y + 10); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(hb.x + 20 - i * 25, hb.y + 10 + i * 10);
    await page.mouse.up();
  }
  await sleep(100);
  const box1 = await card.boundingBox();
  if (!touch || engine === chromium) ok(Math.abs(box1.x - box0.x) > 60, 'the card can be dragged by its title bar');

  await press(page.locator('.rail.right .thumb').nth(2));
  ok((await page.locator('.refcard').count()) === 2, 'a second picture opens a second card');
  // the first card may now be partly covered: tapping its visible title brings it to the front, then its buttons work
  const t1 = await card.locator('.rh .grow').boundingBox();
  if (touch) await page.touchscreen.tap(t1.x + 8, t1.y + t1.height / 2); else await page.mouse.click(t1.x + 8, t1.y + t1.height / 2);
  await sleep(120);
  await press(card.getByRole('button', { name: 'Trace' }));
  ok(await page.locator('#pop').isVisible(), 'tapping a covered card brings it forward and its buttons still work');
  await page.keyboard.press('Escape');

  await press(card.getByRole('button', { name: 'Close' }));
  ok((await page.locator('.refcard').count()) === 1, 'the ✕ button closes the card');
  await b.close();
}

try {
  await sleep(400);
  for (const eng of [chromium, webkit]) for (const touch of [false, true]) await run(eng, touch);
} catch (e) { console.log('  ✗ crashed:', e.message); failures++; }
server.kill();
console.log(failures ? `\n${failures} problem(s)` : '\nall good');
process.exit(failures ? 1 : 0);
