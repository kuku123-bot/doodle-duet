// The relay repairs lost messages: drop some on the way and everything still arrives once, in order.
import { RelayStream, deriveRelay } from '../js/net/relay.js';
import assert from 'node:assert/strict';

const { aes } = await deriveRelay('ABCDEFGHJKLMNPQR');
const got = [];
let broken = 0, dropped = 0, n = 0;
let A, B;
const lossy = (to) => (bytes) => { n++; if (n % 7 === 3 || n % 23 === 0) { dropped++; return; } setTimeout(() => to().feed(bytes), Math.random() * 30); };
A = new RelayStream({ aes, role: 'h', peerRole: 'g', gid: 'abcd0123', publish: lossy(() => B), onText: () => {}, onBroken: () => broken++ });
B = new RelayStream({ aes, role: 'g', peerRole: 'h', gid: 'abcd0123', publish: lossy(() => A), onText: (t) => got.push(+t), onBroken: () => broken++ });
for (let i = 1; i <= 300; i++) { A.send(String(i)); if (i % 20 === 0) await new Promise((r) => setTimeout(r, 15)); }
B.send('ping'); // a later message from the other side keeps the conversation going
const t0 = Date.now();
while (got.length < 300 && Date.now() - t0 < 8000) { A.send('-1'); await new Promise((r) => setTimeout(r, 200)); }
const real = got.filter((x) => x > 0);
assert.equal(broken, 0, 'link never declared broken');
assert.deepEqual(real, Array.from({ length: 300 }, (_, i) => i + 1), 'all 300 messages, in order, exactly once');
console.log(`relay repair ok: ${dropped} of ${n} packets dropped on the way, all 300 messages delivered in order`);
A.kill(); B.kill();
