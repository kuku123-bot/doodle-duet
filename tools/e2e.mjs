// Two people, two browsers: connect through the real PeerJS server, draw, undo, play modes, reconnect, and prove both
// copies of the drawing end up identical. Usage: node tools/e2e.mjs [chromium|webkit] [chromium|webkit]
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ENG = { chromium, webkit };
const [ea = 'chromium', eb = 'chromium'] = process.argv.slice(2);
const TOL = ea === eb ? 0.004 : 0.02; // Safari and Chrome anti-alias edges a little differently
const PORT = 8391, URL0 = `http://localhost:${PORT}/`;
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };
async function waitFor(page, fn, arg, ms = 20000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { if (await page.evaluate(fn, arg)) return true; } catch (e) { /* page busy */ }
    if (Date.now() - t0 > ms) { console.log('  … timed out waiting for ' + label); return false; }
    await sleep(150);
  }
}

async function person(engine, profile, hash = '') {
  const browser = await ENG[engine].launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([p, relay]) => { if (!localStorage.getItem('dd.profile')) localStorage.setItem('dd.profile', JSON.stringify(p)); if (relay) localStorage.setItem('dd.forcerelay', '1'); }, [profile, !!process.env.RELAY && profile.name === 'Bob']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log(`  [${profile.name} page error]`, e.message); failures++; });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${profile.name} console]`, m.text()); });
  await page.goto(URL0 + hash);
  await page.waitForFunction(() => window.app && window.app.doc);
  return { browser, ctx, page, name: profile.name };
}
/** draw with the mouse from doc point to doc point (through screen coordinates) */
async function draw(page, pts, steps = 12) {
  const scr = await page.evaluate((p) => p.map(([x, y]) => window.app.view.toScreen(x, y)), pts);
  await page.mouse.move(scr[0][0], scr[0][1]);
  await page.mouse.down();
  for (let i = 1; i < scr.length; i++) {
    const [ax, ay] = scr[i - 1], [bx, by] = scr[i];
    for (let s = 1; s <= steps; s++) await page.mouse.move(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
  }
  await page.mouse.up();
}
const docState = (page) => page.evaluate(() => {
  const d = window.app.doc, c = d.flatten({});
  const x = c.getContext('2d'), px = x.getImageData(0, 0, c.width, c.height).data;
  let hsh = 0, ink = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i] < 250 || px[i + 1] < 250 || px[i + 2] < 250) ink++; hsh = (hsh * 31 + px[i] * 7 + px[i + 1] * 3 + px[i + 2]) >>> 0; }
  const js = JSON.stringify([...d.ops.values()].map((o) => [o.id, o.k, o.u || 0, o.p, o.m, o.s, o.l, o.b, o.c, o.z, o.o]).sort());
  let dh = 0; for (let i = 0; i < js.length; i++) dh = (dh * 31 + js.charCodeAt(i)) >>> 0;
  return { dh, id: d.id, n: d.opCount, order: d.layerList().map((L) => L.id + ':' + L.ops.map((o) => o.id + (o.u ? 'u' : '')).join(',')).join('|'), ink, hsh, mode: d.mode.id };
});
/** share of 8x8 blocks whose average colour differs (full-resolution pixels, so no engine-specific resampling is involved) */
async function pixelsDiff(a, b) {
  const get = (page) => page.evaluate(() => {
    const c = window.app.doc.flatten({}), W = c.width, H = c.height, px = c.getContext('2d').getImageData(0, 0, W, H).data, B = 8, out = [];
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let r = 0, g = 0, bl = 0, n = 0;
      for (let y = by; y < Math.min(H, by + B); y++) for (let x = bx; x < Math.min(W, bx + B); x++) { const i = (y * W + x) * 4; r += px[i]; g += px[i + 1]; bl += px[i + 2]; n++; }
      out.push(r / n, g / n, bl / n);
    }
    return out;
  });
  const [pa, pb] = await Promise.all([get(a), get(b)]);
  let diff = 0;
  for (let i = 0; i < pa.length; i += 3) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 30) diff++;
  const f = diff / (pa.length / 3);
  if (f > 0) console.log(`    (blocks that differ: ${(f * 100).toFixed(3)}%)`);
  if (f > 0 && process.env.DUMP) {
    const png = (page) => page.evaluate(() => window.app.doc.flatten({}).toDataURL('image/png'));
    const [ia, ib] = await Promise.all([png(a), png(b)]);
    const n = (pixelsDiff.n = (pixelsDiff.n || 0) + 1);
    writeFileSync(`${process.env.DUMP}/a${n}.png`, Buffer.from(ia.split(',')[1], 'base64'));
    writeFileSync(`${process.env.DUMP}/b${n}.png`, Buffer.from(ib.split(',')[1], 'base64'));
  }
  return f;
}

try {
  await sleep(400);
  console.log(`\n== Doodle Duet two-device test: ${ea} + ${eb}`);
  const A = await person(ea, { id: 'alice001', name: 'Alice', color: '#ff5f9e' });
  const link = await A.page.evaluate(() => window.app.inviteLink());
  const hash = link.slice(link.indexOf('#'));
  ok(await waitFor(A.page, () => window.app.net.state === 'waiting', null, 20000, 'A hosting'), 'A opened a room on the matchmaking server');
  const B = await person(eb, { id: 'bobby002', name: 'Bob', color: '#3d9bff' }, hash);
  const t0 = Date.now();
  ok(await waitFor(B.page, () => !!window.app.partner, null, 30000, 'B connected'), 'B joined through the invite link');
  ok(await waitFor(A.page, () => !!window.app.partner, null, 10000, 'A sees B'), 'A sees B');
  console.log(`  (connected in ${Date.now() - t0} ms, via ${await B.page.evaluate(() => window.app.net.via)})`);
  await waitFor(B.page, () => window.app.net.rtt > 0, null, 6000, 'rtt');
  console.log(`  (round trip ${await B.page.evaluate(() => window.app.net.rtt)} ms)`);
  ok((await docState(A.page)).id === (await docState(B.page)).id, 'both show the same drawing');

  // ---- live latency: time from Alice's pointer event to Bob receiving the stroke points
  await B.page.evaluate(() => { const app = window.app, orig = app.onMessage.bind(app); window.__lp = []; app.onMessage = (m) => { if (m.t === 'lp' || m.t === 'ls') window.__lp.push([m.t, Date.now()]); return orig(m); }; });
  const scr = await A.page.evaluate(() => [window.app.view.toScreen(300, 300), window.app.view.toScreen(700, 500)]);
  await A.page.mouse.move(scr[0][0], scr[0][1]);
  const tDown = Date.now();
  await A.page.mouse.down();
  for (let s = 1; s <= 20; s++) await A.page.mouse.move(scr[0][0] + ((scr[1][0] - scr[0][0]) * s) / 20, scr[0][1] + ((scr[1][1] - scr[0][1]) * s) / 20);
  await sleep(process.env.RELAY ? 1200 : 150);
  const lp = await B.page.evaluate(() => window.__lp);
  ok(lp.length > 3, `partner receives the stroke while it is drawn (${lp.length} live messages)`);
  ok(await B.page.evaluate(() => window.app.live.size === 1), 'partner sees it as an in-progress stroke');
  if (lp.length) console.log(`  (first live message after ${lp[0][1] - tDown} ms from pen-down, includes browser automation overhead)`);
  await A.page.mouse.up();
  ok(await waitFor(B.page, () => window.app.doc.opCount === 1 && window.app.live.size === 0, null, 5000, 'stroke committed'), 'stroke committed on both');

  // ---- both draw at the same time
  await Promise.all([
    draw(A.page, [[200, 900], [600, 1200], [900, 950]], 10),
    draw(B.page, [[1100, 300], [1400, 700], [1000, 1300]], 10),
  ]);
  await waitFor(A.page, () => window.app.doc.opCount === 3, null, 5000);
  await waitFor(B.page, () => window.app.doc.opCount === 3, null, 5000);
  let sa = await docState(A.page), sb = await docState(B.page);
  ok(sa.n === 3 && sb.n === 3, 'simultaneous strokes reach both');
  ok(sa.order === sb.order, 'both devices keep the strokes in the same order');
  ok(sa.dh === sb.dh, 'stroke data is identical on both');
  ok((await pixelsDiff(A.page, B.page)) < TOL, 'both pictures are the same pixels');

  // ---- brushes: every brush on Bob, compare
  const brushes = await B.page.evaluate(() => window.app.constructor && ['pencil', 'marker', 'brush', 'water', 'crayon', 'callig', 'air', 'spray', 'high', 'neon']);
  let y = 150;
  for (const b of brushes) {
    await B.page.evaluate((id) => window.app.chooseBrush(id, false), b);
    await B.page.evaluate((c) => window.app.setColor(c, true), ['#e5484d', '#3d8bff', '#22b88f', '#ffb020', '#7a5ac8'][y % 5]);
    await draw(B.page, [[150, y], [500, y + 60], [800, y]], 6);
    y += 130;
  }
  if (process.env.DEBUGRELAY) for (let t = 0; t < 30; t++) {
    const st = await A.page.evaluate(() => { const c = window.app.net.conn, s = c && c.stream; return { n: window.app.doc.opCount, live: window.app.live.size, rx: s && s.rxSeq, hold: s && s.hold.size, state: window.app.net.state }; });
    const sb = await B.page.evaluate(() => { const c = window.app.net.conn, s = c && c.stream; return { n: window.app.doc.opCount, tx: s && s.txSeq, out: window.app.net.out.length }; });
    console.log('   ', t, JSON.stringify(st), JSON.stringify(sb));
    if (st.n === 3 + brushes.length) break;
    await sleep(700);
  }
  await waitFor(A.page, (n) => window.app.doc.opCount === n, 3 + brushes.length, 8000, 'brushes arrive');
  ok((await pixelsDiff(A.page, B.page)) < TOL, `${brushes.length} different brushes look the same on both`);

  // ---- undo / redo
  await A.page.evaluate(() => window.app.undo());
  ok(await waitFor(B.page, () => [...window.app.doc.ops.values()].filter((o) => o.u).length === 1, null, 4000), 'Alice\'s undo reaches Bob');
  await A.page.evaluate(() => window.app.redo());
  ok(await waitFor(B.page, () => [...window.app.doc.ops.values()].filter((o) => o.u).length === 0, null, 4000), 'redo too');
  await B.page.evaluate(() => window.app.undo());
  await sleep(500);
  ok((await pixelsDiff(A.page, B.page)) < TOL, 'pictures still match after undo');

  // ---- fill + text + eraser
  await A.page.evaluate(() => { window.app.setColor('#ffd84d', true); window.app.fillAt(1500, 1500); });
  await A.page.evaluate(() => window.app.commitLocal({ t: 't', l: window.app.layerId, x: 100, y: 1400, s: 'hello love', fo: 'round', z: 90, c: '#7a5ac8', o: 1 }));
  await A.page.evaluate(() => window.app.setTool('eraser'));
  await draw(A.page, [[250, 250], [650, 650]], 8);
  await waitFor(B.page, (n) => window.app.doc.opCount === n, (await A.page.evaluate(() => window.app.doc.opCount)), 6000);
  ok((await pixelsDiff(A.page, B.page)) < TOL, 'fill, text and eraser match');

  // ---- layers
  await B.page.evaluate(() => window.app.addLayer());
  ok(await waitFor(A.page, () => window.app.doc.layerList().length === 2, null, 4000), 'a new layer shows up for the partner');
  await B.page.evaluate(() => window.app.layerUpdate(window.app.layerId, { opacity: 0.5 }));
  ok(await waitFor(A.page, () => window.app.doc.layerList()[1].opacity === 0.5, null, 4000), 'layer opacity syncs');

  // ---- split mode with a moved divider
  await A.page.evaluate(() => window.app.modes.start('split', {}));
  ok(await waitFor(B.page, () => window.app.doc.mode.id === 'split', null, 4000), 'Split mode reaches Bob');
  await A.page.evaluate(() => window.app.modes.set({ pos: 0.3, ov: 0.05 }));
  await waitFor(B.page, () => window.app.doc.mode.p.pos === 0.3, null, 4000);
  const clipB = await B.page.evaluate(() => window.app.modes.clip());
  const clipA = await A.page.evaluate(() => window.app.modes.clip());
  ok(clipA && clipB && clipA[0] === 0 && Math.abs(clipA[2] - 1600 * 0.35) < 1 && Math.abs(clipB[0] - 1600 * 0.25) < 1, `moved divider: Alice gets the left 35%, Bob the right part with overlap (${clipA} / ${clipB})`);
  await B.page.evaluate(() => window.app.setTool('brush'));
  await draw(B.page, [[100, 800], [1500, 820]], 12); // crosses the line: only Bob's side gets ink
  await waitFor(A.page, (n) => window.app.doc.opCount === n, await B.page.evaluate(() => window.app.doc.opCount), 5000);
  const leftInk = await A.page.evaluate(() => { const L = window.app.doc.layerList()[1]; const d = L.ctx.getImageData(0, 780, 380, 60).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  ok(leftInk === 0, 'Bob\'s stroke stays on his side of the line');
  await B.page.evaluate(() => window.app.modes.set({ lock: false }));
  await waitFor(A.page, () => window.app.doc.mode.p.lock === false, null, 4000);
  ok((await A.page.evaluate(() => window.app.modes.clip())) === null, 'unlocked split: draw anywhere');

  // ---- turns mode: only one may draw
  await A.page.evaluate(() => window.app.modes.start('turns', { sec: 30 }));
  await waitFor(B.page, () => window.app.doc.mode.id === 'turns', null, 4000);
  const blockedB = await B.page.evaluate(() => window.app.modes.canDraw());
  const blockedA = await A.page.evaluate(() => window.app.modes.canDraw());
  ok(blockedA === '' && /turn/.test(blockedB), 'Turns: Alice draws, Bob waits');
  await A.page.evaluate(() => window.app.modes.passTurn());
  ok(await waitFor(B.page, () => window.app.modes.canDraw() === '', null, 4000), 'passing the turn lets Bob draw');

  // ---- guess mode: new page, guessing works
  await A.page.evaluate(() => window.app.modes.start('guess', { sec: 80 }));
  ok(await waitFor(B.page, () => window.app.doc.mode.id === 'guess', null, 6000), 'Guess-it starts a fresh page for both');
  const word = await B.page.evaluate(() => window.app.doc.mode.p.word);
  await B.page.evaluate((w) => window.app.sendGuess(w), word);
  ok(await waitFor(A.page, () => window.app.doc.mode.p.score === 1, null, 4000), 'a correct guess scores for the team');

  // ---- shapes, hold-to-snap, laser, reactions, shared pictures + photos, new / reopened drawings
  await A.page.evaluate(() => { const a = window.app; a.modes.start('free', {}); a.settings.shape = 'heart'; a.settings.shapeFill = true; a.setTool('shape'); });
  await waitFor(B.page, () => window.app.doc.mode.id === 'free', null, 4000);
  let n0 = await A.page.evaluate(() => window.app.doc.opCount);
  await draw(A.page, [[300, 300], [700, 650]], 10);
  ok(await waitFor(B.page, (n) => { const d = window.app.doc; if (d.opCount !== n + 1) return false; const o = [...d.ops.values()].sort((x, y) => x.k - y.k).pop(); return o.f === 1 && o.ln === 1 && o.p.length > 60; }, n0, 5000), 'a filled heart shape arrives as a shape');
  await A.page.evaluate(() => window.app.setTool('brush'));
  const sp = await A.page.evaluate(() => [window.app.view.toScreen(200, 1000), window.app.view.toScreen(1200, 1150)]);
  await A.page.mouse.move(sp[0][0], sp[0][1]); await A.page.mouse.down();
  for (let s2 = 1; s2 <= 25; s2++) await A.page.mouse.move(sp[0][0] + ((sp[1][0] - sp[0][0]) * s2) / 25, sp[0][1] + ((sp[1][1] - sp[0][1]) * s2) / 25 + Math.sin(s2) * 6);
  await sleep(900); await A.page.mouse.up();
  ok(await waitFor(B.page, () => { const o = [...window.app.doc.ops.values()].sort((x, y) => x.k - y.k).pop(); return o.ln === 1 && o.p.length === 6; }, null, 5000), 'holding at the end of a wobbly line snaps it straight (for both)');
  await A.page.evaluate(() => window.app.setTool('laser'));
  await draw(A.page, [[400, 400], [900, 500]], 8);
  ok(await waitFor(B.page, () => window.app.lasers.some((t) => t.who === 'p'), null, 3000), 'laser pointer shows on the partner screen');
  await A.page.evaluate(() => window.app.setTool('brush'));
  await A.page.evaluate(() => window.app.react('❤️'));
  ok(await waitFor(B.page, () => document.querySelectorAll('#fx .float').length > 0, null, 3000), 'reactions float up on the partner screen');
  await A.page.evaluate(() => window.app.sendCard('lib:cat'));
  ok(await waitFor(B.page, () => window.app.ideas.cards.has('lib:cat'), null, 3000), 'a shared inspiration picture opens for the partner');
  const phId = await A.page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#ffcc00'; x.fillRect(0, 0, 320, 200); x.fillStyle = '#3d8bff'; x.beginPath(); x.arc(160, 100, 70, 0, 7); x.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const p = await window.app.addPhotoFile(new File([blob], 'our-photo.png', { type: 'image/png' }));
    window.app.addTrace('ph:' + p.id, 'right');
    return p.id;
  });
  ok(await waitFor(B.page, (id) => window.app.photos.has(id) && window.app.doc.refs.list.some((r) => r.src === 'ph:' + id) && !!window.app.refImage('ph:' + id), phId, 8000), 'a personal photo traced on the canvas reaches the partner');
  const oldId = await A.page.evaluate(() => window.app.doc.id), oldN = await A.page.evaluate(() => window.app.doc.opCount);
  await A.page.evaluate(() => window.app.newDoc({}, true));
  const newId = await A.page.evaluate(() => window.app.doc.id);
  ok(await waitFor(B.page, (id) => window.app.doc.id === id, newId, 6000), 'a new drawing opens for both');
  await A.page.evaluate((id) => window.app.openDoc(id), oldId);
  ok(await waitFor(B.page, ([id, n]) => window.app.doc.id === id && window.app.doc.opCount === n, [oldId, oldN], 10000), 'reopening a saved drawing shows it to the partner too');

  // ---- reconnect: Bob goes away, Alice keeps drawing, Bob comes back
  await A.page.evaluate(() => window.app.modes.start('free', {}));
  await waitFor(B.page, () => window.app.doc.mode.id === 'free', null, 4000);
  await B.page.evaluate(() => window.app.saveNow());
  await B.page.close();
  ok(await waitFor(A.page, () => !window.app.partner, null, process.env.RELAY ? 30000 : 15000, 'A notices'), 'Alice notices Bob left');
  await A.page.evaluate(() => window.app.setTool('brush'));
  await draw(A.page, [[300, 1300], [1300, 1300]], 6);
  const B2 = await B.ctx.newPage();
  B2.on('pageerror', (e) => { console.log('  [Bob2 page error]', e.message); failures++; });
  await B2.goto(URL0);
  ok(await waitFor(B2, () => !!window.app.partner, null, 30000, 'B back'), 'Bob reconnects by just opening the app again');
  ok(await waitFor(B2, (n) => window.app.doc.opCount === n, await A.page.evaluate(() => window.app.doc.opCount), 8000, 'catch up'), 'Bob catches up on what he missed');
  sa = await docState(A.page); sb = await docState(B2);
  ok(sa.id === sb.id && sa.order === sb.order && sa.dh === sb.dh, 'same drawing, same order, same data after reconnect');
  ok((await pixelsDiff(A.page, B2)) < TOL, 'same pixels after reconnect');

  await A.browser.close(); await B.browser.close();
} catch (e) { console.log('  ✗ crashed:', e); failures++; }
server.kill();
console.log(failures ? `\n${failures} problem(s)` : '\nall good');
process.exit(failures ? 1 : 0);
