// Draws the app icon (two halves of a heart, one per person) and writes icons/*.png. Usage: node tools/icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../icons/', import.meta.url));
const b = await chromium.launch();
const page = await b.newPage();
const urls = await page.evaluate(() => {
  const draw = (S) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#ff7aa8'); g.addColorStop(0.55, '#9b7bff'); g.addColorStop(1, '#59a8ff');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const k = S / 512; x.save(); x.scale(k, k);
    // soft glow
    const rg = x.createRadialGradient(256, 230, 20, 256, 256, 300); rg.addColorStop(0, 'rgba(255,255,255,0.28)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = rg; x.fillRect(0, 0, 512, 512);
    const heart = new Path2D('M256 412 C 150 340 92 282 92 206 C 92 150 134 112 184 112 C 220 112 244 132 256 156 C 268 132 292 112 328 112 C 378 112 420 150 420 206 C 420 282 362 340 256 412 Z');
    x.shadowColor = 'rgba(60, 20, 110, 0.35)'; x.shadowBlur = 28; x.shadowOffsetY = 10;
    x.save(); x.beginPath(); x.rect(0, 0, 256, 512); x.clip(); x.fillStyle = '#ffffff'; x.fill(heart); x.restore();
    x.save(); x.beginPath(); x.rect(256, 0, 256, 512); x.clip(); x.fillStyle = '#fff1c9'; x.fill(heart); x.restore();
    x.shadowColor = 'transparent';
    x.setLineDash([16, 14]); x.lineWidth = 7; x.lineCap = 'round'; x.strokeStyle = '#9b7bff'; x.beginPath(); x.moveTo(256, 150); x.lineTo(256, 400); x.stroke();
    // a little pencil scribble on each half
    x.setLineDash([]); x.lineWidth = 12; x.strokeStyle = '#ff5f9e'; x.beginPath(); x.moveTo(150, 230); x.quadraticCurveTo(185, 190, 215, 238); x.stroke();
    x.strokeStyle = '#3d9bff'; x.beginPath(); x.moveTo(297, 238); x.quadraticCurveTo(327, 190, 362, 230); x.stroke();
    x.restore();
    return c.toDataURL('image/png');
  };
  return { 512: draw(512), 192: draw(192), 180: draw(180), 32: draw(32) };
});
const save = (name, u) => writeFileSync(out + name, Buffer.from(u.split(',')[1], 'base64'));
save('icon-512.png', urls[512]); save('icon-192.png', urls[192]); save('apple-touch-icon.png', urls[180]); save('favicon-32.png', urls[32]);
await b.close();
console.log('icons written');
