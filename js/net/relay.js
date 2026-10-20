// Last-resort transport for two devices that cannot reach each other directly (strict or carrier-grade NAT, some mobile networks).
// Messages travel through free public MQTT brokers, which only ever see ciphertext: everything is sealed with AES-GCM under a secret
// that exists only in the invite ("backup code"), topic names are derived from a hash of it, and every message carries a sequence
// number so replays/gaps are detected. It exposes the same conn interface as the WebRTC transports, so the session code treats both the same.
import { MqttClient } from './mqtt.js';
import { parseRelayKey } from './relaykey.js';
export { makeRelayKey, formatRelayKey, parseRelayKey } from './relaykey.js';

// Measured with 15-80 messages/s: HiveMQ delivered 100%, EMQX dropped 30-70% (it throttles per connection), Mosquitto's test server is
// sometimes unreachable. So: HiveMQ first; the others only join the race if it is slow.
export const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
const STAGGER_MS = 2500;
const MAX_PAYLOAD = 1 << 20;
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ crypto
export async function deriveRelay(key) {
  const subtle = crypto.subtle;
  const room = new Uint8Array(await subtle.digest('SHA-256', enc.encode('doodle-duet/room/' + key)));
  const raw = await subtle.digest('SHA-256', enc.encode('doodle-duet/key/' + key));
  const aes = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { roomId: hex(room.subarray(0, 10)), aes };
}
async function seal(aes, role, gid, seq, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(`${role}|${gid}|${seq}|${text}`)));
  const out = new Uint8Array(13 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return out;
}
/** returns {role, gid, seq, text} or null for anything that is not a valid message sealed with our key */
async function unseal(aes, bytes) {
  try {
    if (!bytes || bytes.length < 13 + 16 || bytes.length > MAX_PAYLOAD || bytes[0] !== 1) return null;
    const plain = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(1, 13) }, aes, bytes.subarray(13)));
    const a = plain.indexOf('|'), b = plain.indexOf('|', a + 1), c = plain.indexOf('|', b + 1);
    if (a < 0 || b < 0 || c < 0) return null;
    return { role: plain.slice(0, a), gid: plain.slice(a + 1, b), seq: +plain.slice(b + 1, c), text: plain.slice(c + 1) };
  } catch (e) { return null; }
}
const topicHost = (room) => `doodleduet/1/${room}/h`;
const topicGuest = (room, gid) => `doodleduet/1/${room}/g/${gid}`;

/** resolves with the first promise that succeeds; later successes are cleaned up with `dispose` */
function firstSuccess(promises, dispose) {
  return new Promise((resolve, reject) => {
    let left = promises.length, done = false, lastErr = null;
    if (!left) return reject(new Error('no relay servers'));
    for (const p of promises) p.then((v) => { if (done) { dispose(v); return; } done = true; resolve(v); }, (e) => { lastErr = e; if (--left === 0 && !done) reject(lastErr); });
  });
}

// ------------------------------------------------------------------ one ordered, authenticated stream (shared by both sides)
// Public brokers deliver with QoS 0, so now and then a message is simply lost. The receiver notices the gap (a later
// message arrives first) and asks the sender to repeat the missing ones (an unnumbered "nack" control message, seq 0);
// the sender keeps its last KEEP sealed messages for that. Only if the gap is still open after GAP_MS is the link
// declared broken (the app then reconnects and syncs).
const GAP_MS = 5000, NACK_AT = [150, 600, 1400, 2600, 3800], KEEP = 1000;
export class RelayStream {
  constructor({ aes, role, peerRole, gid, publish, onText, onBroken }) {
    Object.assign(this, { aes, role, peerRole, gid, publish, onText, onBroken });
    this.txSeq = 0; this.rxSeq = 0; this.tx = Promise.resolve(); this.rx = Promise.resolve(); this.dead = false;
    this.hold = new Map(); this.gapTimer = null; this.nackTimers = []; this.sent = new Map();
  }
  kill() { this.dead = true; this._clearGap(); this.hold.clear(); this.sent.clear(); }
  send(text) {
    if (this.dead) return;
    const n = ++this.txSeq; // numbered now, sealed and published strictly in order
    this.tx = this.tx.then(() => seal(this.aes, this.role, this.gid, n, text)).then((bytes) => {
      if (this.dead) return;
      this.sent.set(n, bytes);
      if (this.sent.size > KEEP) this.sent.delete(this.sent.keys().next().value);
      this.publish(bytes);
    }).catch(() => {});
  }
  _control(text) {
    if (this.dead) return;
    this.tx = this.tx.then(() => seal(this.aes, this.role, this.gid, 0, text)).then((bytes) => { if (!this.dead) this.publish(bytes); }).catch(() => {});
  }
  /** feed a raw payload; messages are decrypted one after another so their order survives the async crypto */
  feed(bytes, from) {
    this.rx = this.rx.then(async () => { if (!this.dead) this.accept(await unseal(this.aes, bytes), from); }).catch(() => {});
  }
  /** an already-decrypted message: duplicates are dropped, reordering and lost messages are repaired */
  accept(m, from) {
    if (this.dead || !m || m.role !== this.peerRole || m.gid !== this.gid) return; // not ours / wrong direction / forged: ignore silently
    if (m.seq === 0) { this._onControl(m.text); return; }
    if (m.seq <= this.rxSeq) return;
    if (m.seq > this.rxSeq + 1) {
      if (this.hold.size >= 1024) return this._broken('too many messages out of order');
      this.hold.set(m.seq, m);
      if (!this.gapTimer) this._armGap();
      return;
    }
    const before = this.rxSeq;
    this._deliver(m, from);
    for (let next = this.hold.get(this.rxSeq + 1); next; next = this.hold.get(this.rxSeq + 1)) this._deliver(next, from);
    if (!this.hold.size) this._clearGap();
    else if (this.rxSeq !== before) { this._clearGap(); this._armGap(); } // the next gap gets its own repair round
  }
  _armGap() {
    this.gapTimer = setTimeout(() => { this.gapTimer = null; if (this.hold.size && !this.dead) this._broken(`expected message ${this.rxSeq + 1} but only later ones arrived`); }, GAP_MS);
    this.nackTimers = NACK_AT.map((ms) => setTimeout(() => {
      if (this.dead || !this.hold.size) return;
      // every hole up to the newest message we hold, as ranges: "a-b,c-d"
      const top = Math.max(...this.hold.keys()), ranges = [];
      for (let s = this.rxSeq + 1; s < top && ranges.length < 60; s++) {
        if (this.hold.has(s)) continue;
        let e = s; while (e + 1 < top && !this.hold.has(e + 1)) e++;
        ranges.push(s + '-' + e); s = e;
      }
      if (ranges.length) this._control('nack:' + ranges.join(','));
    }, ms));
  }
  _clearGap() { clearTimeout(this.gapTimer); this.gapTimer = null; for (const t of this.nackTimers) clearTimeout(t); this.nackTimers = []; }
  _onControl(text) {
    if (!text.startsWith('nack:')) return;
    let budget = 600;
    for (const r of text.slice(5).split(',')) {
      const m = /^(\d+)-(\d+)$/.exec(r);
      if (!m) continue;
      for (let s = +m[1]; s <= +m[2] && budget > 0; s++, budget--) { const bytes = this.sent.get(s); if (bytes) this.publish(bytes); }
    }
  }
  _deliver(m, from) { this.rxSeq = m.seq; this.hold.delete(m.seq); this.onText(m.text, from); }
  _broken(why) { console.warn('relay: ' + why); this.onBroken(why); } // messages could be missing: reconnect and sync again
}

// ------------------------------------------------------------------ guest side
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The guest may reach only some of the relay servers, and the host only others, so until the host answers it speaks on every server it
 *  can reach (everything sent so far is repeated on each newly joined server); the first reply pins the conversation to its server. */
class RelayGuestConn {
  constructor({ room, aes, gid, brokers, WS, timeoutMs, staggerMs }) {
    this.staggerMs = staggerMs; this.room = room; this.onmessage = null; this.onclose = null; this.open = true; this._said = false;
    this.clients = new Set(); this.pinned = null; this.pending = []; this.failed = 0; this.total = brokers.length;
    this.stream = new RelayStream({
      aes, role: 'g', peerRole: 'h', gid, publish: (bytes) => this._publish(bytes),
      onText: (t, from) => { if (!this.pinned && from) this._pin(from); if (this.onmessage) this.onmessage(t); }, onBroken: () => this._end(),
    });
    this.ready = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
    this.ready.catch(() => {});
    brokers.forEach((url, i) => this._join(url, i, WS, timeoutMs, aes, gid));
  }
  async _join(url, i, WS, timeoutMs, aes, gid) {
    if (i) await sleep(i * this.staggerMs);
    if (this._said || this.pinned) return this._failed(null);
    const c = new MqttClient(url, WS ? { WS } : {});
    try { await c.connect(timeoutMs); await c.subscribe(topicGuest(this.room, gid)); } catch (e) { c.close(); return this._failed(e); }
    if (this._said || this.pinned) { c.close(); return; }
    this.clients.add(c);
    c.onmessage = (topic, payload) => this.stream.feed(payload, c);
    c.onclose = () => { this.clients.delete(c); if (c === this.pinned || (!this.pinned && !this.clients.size && this.failed >= this.total - 1)) this._end(); };
    for (const bytes of this.pending) c.publish(topicHost(this.room), bytes); // everything said so far goes out here too
    this._resolve();
  }
  _failed(e) { if (++this.failed >= this.total && !this.clients.size) this._reject(new Error('Could not reach any backup relay server. Check your internet connection.')); }
  _publish(bytes) {
    if (this.pinned) { if (this.pinned.open) this.pinned.publish(topicHost(this.room), bytes); return; }
    this.pending.push(bytes);
    for (const c of this.clients) c.publish(topicHost(this.room), bytes);
  }
  _pin(client) {
    this.pinned = client; this.pending = [];
    // the host may still answer on the other servers for a few seconds; those copies are duplicates and are dropped by sequence number
    setTimeout(() => { for (const c of [...this.clients]) if (c !== client) { this.clients.delete(c); c.close(); } }, 15000);
  }
  send(text) { this.stream.send(text); }
  get lowRate() { return true; } // public brokers throttle: the app sends fewer, fuller updates over this link
  get buffered() { const c = this.pinned || [...this.clients][0]; return c ? c.buffered : 0; }
  close() { this._end(); }
  _end() { if (this._said) return; this._said = true; this.open = false; this.stream.kill(); for (const c of [...this.clients]) { this.clients.delete(c); try { c.close(); } catch (e) { /* ignore */ } } if (this.onclose) this.onclose(); }
}

/** Connect to a host through the relay. Resolves {conn} once a relay server is reachable and our inbox is subscribed. */
export async function connectRelay(keyText, { onStatus = () => {}, brokers = BROKERS, WS = undefined, timeoutMs = 9000, staggerMs = STAGGER_MS } = {}) {
  const key = parseRelayKey(keyText);
  if (!key) throw new Error('That backup code does not look right (it has 16 letters and numbers).');
  const { roomId, aes } = await deriveRelay(key);
  const gid = hex(crypto.getRandomValues(new Uint8Array(4)));
  onStatus('Reaching the backup relay…');
  const conn = new RelayGuestConn({ room: roomId, aes, gid, brokers, WS, timeoutMs, staggerMs });
  try { await conn.ready; } catch (e) { conn.close(); throw e; }
  onStatus('Connected to the backup relay…');
  return { conn };
}

// ------------------------------------------------------------------ host side
const BROKER_MEMORY_MS = 15000;
class RelayHostConn {
  constructor(hub, gid) {
    this.hub = hub; this.gid = gid; this.brokers = new Map(); this.onmessage = null; this.onclose = null; this.open = true; this._said = false; this.lastRx = Date.now();
    this.stream = new RelayStream({
      aes: hub.aes, role: 'h', peerRole: 'g', gid,
      // answer on every server this guest was recently heard on (normally exactly one; briefly two while they settle on one)
      publish: (bytes) => { const now = Date.now(); for (const [b, ts] of this.brokers) { if (now - ts > BROKER_MEMORY_MS || !b.open) { if (!b.open || this.brokers.size > 1) this.brokers.delete(b); continue; } b.publish(topicGuest(hub.roomId, gid), bytes); } },
      onText: (t) => { this.lastRx = Date.now(); this.onmessage && this.onmessage(t); }, onBroken: () => this._end(),
    });
  }
  send(text) { this.stream.send(text); }
  get lowRate() { return true; }
  get buffered() { let m = 0; for (const b of this.brokers.keys()) m = Math.max(m, b.buffered); return m; }
  close() { this._end(); }
  _end() { if (this._said) return; this._said = true; this.open = false; this.stream.kill(); this.hub.guests.delete(this.gid); if (this.onclose) this.onclose(); }
}

export class RelayHost {
  constructor(keyText, { onConnection, onStatus = () => {}, brokers = BROKERS, WS = undefined } = {}) {
    this.key = parseRelayKey(keyText);
    if (!this.key) throw new Error('bad relay key');
    this.onConnection = onConnection; this.onStatus = onStatus; this.brokerUrls = brokers; this.WS = WS;
    this.guests = new Map(); this.up = new Set(); this.running = false; this.timers = new Set(); this.rx = Promise.resolve();
  }
  /** resolves once at least one relay server is reachable; the others keep trying in the background */
  async start() {
    const { roomId, aes } = await deriveRelay(this.key);
    this.roomId = roomId; this.aes = aes; this.running = true;
    this.sweep = setInterval(() => { for (const c of [...this.guests.values()]) if (Date.now() - c.lastRx > 60000) c._end(); }, 10000);
    const first = this.brokerUrls.map((url) => this._connect(url, 0));
    try { await firstSuccess(first, () => {}); } catch (e) { this.stop(); throw new Error('Could not reach any backup relay server.'); }
    this._status();
  }
  _status() { this.onStatus(this.up.size ? `Backup relay ready (${this.up.size} of ${this.brokerUrls.length} servers)` : 'Backup relay reconnecting…'); }
  async _connect(url, attempt) {
    if (!this.running) throw new Error('stopped');
    const c = new MqttClient(url, this.WS ? { WS: this.WS } : {});
    try {
      await c.connect(9000); await c.subscribe(topicHost(this.roomId));
    } catch (e) {
      c.close();
      if (this.running) { const wait = Math.min(60000, 4000 * 2 ** attempt); const t = setTimeout(() => { this.timers.delete(t); this._connect(url, attempt + 1).catch(() => {}); }, wait); this.timers.add(t); }
      throw e;
    }
    this.up.add(c);
    c.onmessage = (topic, payload) => { this.rx = this.rx.then(() => this._incoming(c, payload)).catch(() => {}); };
    c.onclose = () => { this.up.delete(c); for (const g of this.guests.values()) g.brokers.delete(c); if (this.running) { this._status(); const t = setTimeout(() => { this.timers.delete(t); this._connect(url, 0).catch(() => {}); }, 3000); this.timers.add(t); } };
    this._status();
    return c;
  }
  async _incoming(broker, payload) {
    const m = await unseal(this.aes, payload);
    if (!m || m.role !== 'g' || !/^[0-9a-f]{8}$/.test(m.gid)) return;
    let g = this.guests.get(m.gid);
    if (!g) {
      if (m.seq !== 1 || this.guests.size >= 8) return; // a stream only begins at its first message
      g = new RelayHostConn(this, m.gid);
      this.guests.set(m.gid, g);
      g.brokers.set(broker, Date.now());
      this.onConnection(g);
    }
    g.brokers.set(broker, Date.now());
    g.stream.accept(m, broker);
  }
  stop() {
    this.running = false; clearInterval(this.sweep);
    for (const t of this.timers) clearTimeout(t); this.timers.clear();
    for (const g of [...this.guests.values()]) g._end();
    for (const c of [...this.up]) c.close();
    this.up.clear();
  }
}
