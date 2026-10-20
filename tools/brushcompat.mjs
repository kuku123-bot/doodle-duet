// Old brushes must render exactly as before (saved drawings replay with them): compares js/brushes.js against a copy of
// the previous version at js/_old_brushes.js (make it with: git show <ref>:js/brushes.js > js/_old_brushes.js).
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.mjs', '8398'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
let bad = 0;
for (const eng of [chromium, webkit]) {
  const b = await eng.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8398/manifest.webmanifest');
  const res = await p.evaluate(async () => {
    const NEW = await import('http://localhost:8398/js/brushes.js'), OLD = await import('http://localhost:8398/js/_old_brushes.js');
    const out = {};
    for (const B of OLD.BRUSHES) {
      const draw = (M, sym) => {
        const c = document.createElement('canvas'); c.width = 600; c.height = 300; const x = c.getContext('2d');
        const s = document.createElement('canvas'); s.width = 600; s.height = 300; const sx = s.getContext('2d');
        if (B.erase) { x.fillStyle = '#888'; x.fillRect(0, 0, 600, 300); }
        const pts = []; for (let k = 0; k <= 50; k++) { const t = k / 50; pts.push(30 + t * 540, 150 + Math.sin(t * 9) * 70, 0.2 + 0.8 * Math.abs(Math.sin(t * 5))); }
        const op = { b: B.id, c: '#3d8bff', z: 22, o: 0.8, sd: 4242, p: pts, sym };
        const r = new M.StrokeRenderer(op, sx); r.add(pts.slice(0, 60)); r.add(pts.slice(60)); r.finish();
        M.compositeStroke(x, op, s, M.bbRect(r.bb, 600, 300));
        return x.getImageData(0, 0, 600, 300).data;
      };
      for (const sym of [undefined, 'v', 'k6']) {
        const a = draw(OLD, sym), n = draw(NEW, sym);
        let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== n[i]) diff++;
        out[B.id + (sym ? '/' + sym : '')] = diff;
      }
    }
    return out;
  });
  const changed = Object.entries(res).filter(([, d]) => d > 0);
  console.log(`${eng.name()}: ${Object.keys(res).length} old brush renders compared, ${changed.length ? 'CHANGED: ' + JSON.stringify(changed) : 'all identical'}`);
  if (changed.length) bad++;
  await b.close();
}
server.kill();
process.exit(bad ? 1 : 0);
