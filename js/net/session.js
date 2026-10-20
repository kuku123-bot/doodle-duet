// One room, two people. Whoever opens the room first owns its id on the signaling server ("host"); the other device joins
// it. Roles only matter for connecting: the drawing itself is merged symmetrically (see doc.js). If the host leaves, the
// other device takes the room over, so "our room" link always works no matter who opens the app first.
// Transport order: direct WebRTC first, then the encrypted MQTT relay (needs the room key from the invite link).
import { claimRoom, connectToHost } from './transport.js';
import { RelayHost, connectRelay } from './relay.js';

export const PROTOCOL = 2; // 2: new brushes (an older page would draw them as the ink pen)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// testing aid: skip the direct link and use the relay (only on this computer)
const forceRelay = () => { try { return localStorage.getItem('dd.forcerelay') === '1' && ['localhost', '127.0.0.1'].includes(location.hostname); } catch (e) { return false; } };
const CHUNK_DIRECT = 16000, CHUNK_RELAY = 48000, BATCH_MS = 100;

export class Session {
  /** h: { me() -> {id,name,color}, onPartner(partner), onLeave(partner), onMessage(msg), onState(session), onMismatch(v) } */
  constructor(h) {
    this.h = h; this.gen = 0; this.room = null; this.peer = null; this.relay = null; this.conn = null; this.partner = null;
    this.role = null; this.rtt = 0; this.state = 'off'; this.text = ''; this.lastRx = 0;
    this.out = []; this.pumping = false; this.chunks = new Map(); this.ckId = 0; this.lastChunkAt = 0; this.batch = []; this.batchT = null;
    setInterval(() => this._tick(), 2000);
  }
  get connected() { return !!(this.conn && this.conn.open && this.partner); }
  get via() { return this.conn ? (this.conn.lowRate ? 'relay' : 'direct') : null; }
  get lowRate() { return !!(this.conn && this.conn.lowRate); }
  _set(state, text) { this.state = state; this.text = text; if (this.h.onState) this.h.onState(this); }

  start(room) {
    this.stop();
    this.room = room;
    const gen = ++this.gen;
    this._loop(gen);
  }
  stop() {
    this.gen++;
    const c = this.conn; this.conn = null;
    if (c) { try { c.close(); } catch (e) { /* ignore */ } }
    if (this.partner) { const p = this.partner; this.partner = null; if (this.h.onLeave) this.h.onLeave(p); }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } this.peer = null; }
    if (this.relay) { try { this.relay.stop(); } catch (e) { /* ignore */ } this.relay = null; }
    this.role = null; this.out = []; this.chunks.clear();
    this._set('off', '');
  }

  async _loop(gen) {
    let fails = 0;
    while (gen === this.gen) {
      if (!this.partner) this._set('connecting', 'Opening your room…');
      // 1) own the room if nobody else does
      try {
        const peer = await claimRoom(this.room.code, {
          onConnection: (c) => this._incoming(c, gen),
          onStatus: (t) => { if (gen === this.gen && !this.partner) this._set('waiting', t); },
          onLost: () => { if (gen === this.gen) this.start(this.room); },
        });
        if (gen !== this.gen) { try { peer.destroy(); } catch (e) { /* ignore */ } return; }
        this.peer = peer; this.role = 'host';
        if (this.room.key) this._startRelay(gen);
        if (!this.partner) this._set('waiting', 'Waiting for your partner…');
        return;
      } catch (e) {
        if (gen !== this.gen) return;
        if (e.type !== 'taken') {
          fails++;
          this._set('connecting', e.type === 'nolib' ? e.message : 'Cannot reach the matchmaking server. Retrying…');
          await wait(Math.min(15000, 2000 * fails));
          continue;
        }
      }
      // 2) the room is open on the other device: join it
      this.role = 'guest';
      try {
        this._set('connecting', 'Connecting to your partner…');
        let conn = null;
        try {
          if (forceRelay() && this.room.key) throw Object.assign(new Error('relay forced'), { type: 'forced' });
          conn = await connectToHost(this.room.code);
        } catch (e) {
          if (e.type === 'empty' || !this.room.key || gen !== this.gen) throw e;
          this._set('connecting', 'Direct link blocked by the network. Trying the backup connection…');
          ({ conn } = await connectRelay(this.room.key));
        }
        if (gen !== this.gen) { conn.close(); return; }
        await this._runGuest(conn, gen);
        fails = 0;
      } catch (e) {
        if (gen !== this.gen) return;
        fails++;
        const hint = !this.room.key && e.type !== 'empty' ? ' (Opening the invite link instead of typing the code adds a backup connection.)' : '';
        this._set('connecting', (e.message || 'Connection failed.') + ' Retrying…' + hint);
      }
      if (gen !== this.gen) return;
      await wait(fails ? Math.min(8000, 800 * fails) : 400);
    }
  }

  _startRelay(gen) {
    try {
      const r = new RelayHost(this.room.key, { onConnection: (c) => this._incoming(c, gen) });
      this.relay = r;
      r.start().catch(() => { if (this.relay === r) this.relay = null; });
    } catch (e) { this.relay = null; }
  }

  _runGuest(conn, gen) {
    return new Promise((resolve) => {
      let accepted = false;
      const t = setTimeout(() => { if (!accepted) conn.close(); }, conn.lowRate ? 15000 : 8000);
      this._wire(conn, (hello) => {
        if (accepted) return;
        accepted = true; clearTimeout(t);
        if (gen !== this.gen) { conn.close(); return; }
        this._adopt(conn, hello);
      }, () => { clearTimeout(t); resolve(); });
      this._raw(conn, { t: 'hello', ...this.h.me(), v: PROTOCOL });
    });
  }

  _incoming(conn, gen) {
    if (gen !== this.gen) { conn.close(); return; }
    const t = setTimeout(() => { if (conn !== this.conn) conn.close(); }, 12000);
    let seen = false;
    this._wire(conn, (hello) => {
      if (seen) return;
      seen = true; clearTimeout(t);
      const cur = this.conn;
      // a third device while the partner is clearly still here: say no (a returning partner always gets in)
      if (cur && cur !== conn && cur.open && this.partner && hello.id !== this.partner.id && Date.now() - this.lastRx < 6000) {
        this._raw(conn, { t: 'full' }); setTimeout(() => conn.close(), 400); return;
      }
      if (cur && cur !== conn) { this._drop(cur); try { cur.close(); } catch (e) { /* ignore */ } }
      this._raw(conn, { t: 'hello', ...this.h.me(), v: PROTOCOL });
      this._adopt(conn, hello);
    });
  }

  _wire(conn, onHello, onClose) {
    conn.onmessage = (s) => this._rx(conn, s, onHello);
    conn.onclose = () => { if (this.conn === conn) this._drop(conn); if (onClose) onClose(); };
  }
  _adopt(conn, hello) {
    this.conn = conn; this.lastRx = Date.now(); this.out = []; this.batch = []; this.chunks.clear();
    this.partner = { id: String(hello.id || ''), name: String(hello.name || 'Partner').slice(0, 24), color: String(hello.color || '#4ea1ff') };
    if (hello.v !== PROTOCOL && this.h.onMismatch) this.h.onMismatch(hello.v);
    this._set('connected', this.via === 'relay' ? 'Connected through the backup relay' : 'Connected directly');
    if (this.h.onPartner) this.h.onPartner(this.partner);
  }
  _drop(conn) {
    if (this.conn !== conn) return;
    const p = this.partner;
    this.conn = null; this.partner = null; this.out = []; this.batch = []; this.chunks.clear();
    if (this.role === 'host') this._set('waiting', 'Waiting for your partner…');
    else this._set('connecting', 'Reconnecting…');
    if (p && this.h.onLeave) this.h.onLeave(p);
  }

  _rx(conn, s, onHello) {
    let m;
    try { m = JSON.parse(s); } catch (e) { return; }
    this._handle(conn, m, onHello);
  }
  _handle(conn, m, onHello) {
    if (!m || typeof m.t !== 'string') return;
    if (conn === this.conn) this.lastRx = Date.now();
    if (m.t === '_b') { if (Array.isArray(m.m)) for (const x of m.m) this._handle(conn, x, onHello); return; }
    if (m.t === '_ck') {
      if (conn !== this.conn) return;
      let c = this.chunks.get(m.id);
      if (!c) { c = { n: m.n, parts: new Array(m.n), got: 0 }; this.chunks.set(m.id, c); }
      if (c.parts[m.i] === undefined) { c.parts[m.i] = m.d; c.got++; }
      if (c.got === c.n) { this.chunks.delete(m.id); this._rx(conn, c.parts.join(''), onHello); }
      return;
    }
    if (m.t === 'hello') { onHello(m); return; }
    if (m.t === 'bye') { if (conn === this.conn) conn.close(); return; }
    if (m.t === 'full') { this._set('connecting', 'That room already has two people in it.'); conn.close(); return; }
    if (conn !== this.conn) return;
    if (m.t === 'ping') { this._raw(conn, { t: 'pong', ts: m.ts }); return; }
    if (m.t === 'pong') { const r = Date.now() - m.ts; this.rtt = this.rtt ? Math.round(this.rtt * 0.6 + r * 0.4) : r; if (this.h.onState) this.h.onState(this); return; }
    if (this.h.onMessage) this.h.onMessage(m);
  }

  _tick() {
    const c = this.conn;
    if (!c || !this.partner) return;
    if (Date.now() - this.lastRx > (c.lowRate ? 16000 : 8000)) { c.close(); return; }
    this._raw(c, { t: 'ping', ts: Date.now() });
  }
  /** the page is closing: tell the partner right away (the relay has no connection that could break) */
  bye() { if (this.conn) this._raw(this.conn, { t: 'bye' }); }
  _raw(conn, obj) { try { conn.send(JSON.stringify(obj)); } catch (e) { /* closed */ } }

  /** queue a message for the partner (big ones are split into chunks); returns false when nobody is connected */
  send(obj) {
    if (!this.connected) return false;
    const s = JSON.stringify(obj);
    // relay: public brokers drop messages when they come thick and fast, so small ones travel together, 10 bundles a second
    if (this.lowRate && s.length < 8000) {
      this.batch.push(s);
      if (!this.batchT) this.batchT = setTimeout(() => this._flushBatch(), BATCH_MS);
      return true;
    }
    this._flushBatch(); // keep the order: anything batched goes out before this bigger message
    this._enqueue(s);
    return true;
  }
  _flushBatch() {
    clearTimeout(this.batchT); this.batchT = null;
    if (!this.batch.length) return;
    const s = this.batch.length === 1 ? this.batch[0] : '{"t":"_b","m":[' + this.batch.join(',') + ']}';
    this.batch = [];
    if (this.connected) this._enqueue(s);
  }
  _enqueue(s) {
    const max = this.lowRate ? CHUNK_RELAY : CHUNK_DIRECT;
    if (s.length <= max) this.out.push({ s, ck: false });
    else {
      const id = ++this.ckId, n = Math.ceil(s.length / max);
      for (let i = 0; i < n; i++) this.out.push({ s: JSON.stringify({ t: '_ck', id, i, n, d: s.slice(i * max, (i + 1) * max) }), ck: true });
    }
    this._pump();
  }
  _pump() {
    if (this.pumping) return;
    const c = this.conn;
    while (this.out.length && c && c.open) {
      const next = this.out[0];
      const later = (ms) => { this.pumping = true; setTimeout(() => { this.pumping = false; this._pump(); }, ms); };
      if (c.buffered > (c.lowRate ? 200000 : 2000000)) return later(15);
      if (c.lowRate && next.ck && Date.now() - this.lastChunkAt < 35) return later(35);
      this.out.shift();
      if (next.ck) this.lastChunkAt = Date.now();
      try { c.send(next.s); } catch (e) { this.out.unshift(next); return later(50); }
    }
  }
}
