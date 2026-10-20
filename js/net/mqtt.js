// A tiny MQTT 3.1.1 client over WebSocket (QoS 0 only). Public MQTT brokers act as a dumb message relay, which is the last-resort
// transport when two devices cannot reach each other directly (strict / carrier-grade NAT). See net/relay.js for the secure layer.
const enc = new TextEncoder(), dec = new TextDecoder();

function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function packet(type, flags, body) { const len = varLen(body.length); const out = new Uint8Array(1 + len.length + body.length); out[0] = (type << 4) | flags; out.set(len, 1); out.set(body, 1 + len.length); return out; }

export class MqttClient {
  constructor(url, { clientId = 'dd-' + Math.random().toString(36).slice(2, 10), keepalive = 30, WS = (typeof WebSocket !== 'undefined' ? WebSocket : null) } = {}) {
    this.url = url; this.clientId = clientId; this.keepalive = keepalive; this.WS = WS;
    this.onmessage = null; this.onclose = null; this.open = false; this.closed = false;
    this.buf = new Uint8Array(0); this.nextId = 1; this.pingT = null; this.waiters = new Map();
  }
  /** resolves once CONNACK(accepted) arrives */
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; clearTimeout(t); this.close(); reject(e instanceof Error ? e : new Error(String(e))); };
      const t = setTimeout(() => fail(new Error('relay server did not answer')), timeoutMs);
      let ws;
      try { ws = new this.WS(this.url, 'mqtt'); } catch (e) { return fail(e); }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        const body = [...str('MQTT'), 4, 0x02, this.keepalive >> 8, this.keepalive & 255, ...str(this.clientId)];
        ws.send(packet(1, 0, new Uint8Array(body)));
      };
      ws.onerror = () => fail(new Error('could not reach the relay server'));
      ws.onclose = () => { this._down(); if (!settled) fail(new Error('relay server closed the connection')); };
      ws.onmessage = (e) => {
        this._feed(new Uint8Array(e.data));
      };
      this._onConnack = (rc) => { if (rc !== 0) return fail(new Error('relay server refused us (code ' + rc + ')')); if (settled) return; settled = true; clearTimeout(t); this.open = true; this.pingT = setInterval(() => this._send(packet(12, 0, new Uint8Array(0))), this.keepalive * 500); resolve(this); };
    });
  }
  _send(u8) { if (this.ws && this.ws.readyState === 1) this.ws.send(u8); }
  subscribe(filter, timeoutMs = 6000) {
    const id = this.nextId++ & 0xffff || 1;
    const p = new Promise((resolve, reject) => { const t = setTimeout(() => { this.waiters.delete(id); reject(new Error('subscribe timed out')); }, timeoutMs); this.waiters.set(id, () => { clearTimeout(t); resolve(); }); });
    this._send(packet(8, 2, new Uint8Array([id >> 8, id & 255, ...str(filter), 0])));
    return p;
  }
  publish(topic, payload) {
    const t = str(topic), pl = payload instanceof Uint8Array ? payload : enc.encode(String(payload));
    const body = new Uint8Array(t.length + pl.length); body.set(t, 0); body.set(pl, t.length);
    this._send(packet(3, 0, body));
  }
  get buffered() { return (this.ws && this.ws.bufferedAmount) || 0; }
  close() { if (this.closed) return; this.closed = true; try { if (this.ws && this.ws.readyState === 1) this.ws.send(packet(14, 0, new Uint8Array(0))); } catch (e) { /* ignore */ } try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } this._down(); }
  _down() { const was = this.open; this.open = false; clearInterval(this.pingT); if ((was || this.closed) && !this._said) { this._said = true; this.onclose && this.onclose(); } }

  _feed(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf, 0); b.set(chunk, this.buf.length); this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let mul = 1, len = 0, i = 1, d;
      do { if (i >= this.buf.length) return; d = this.buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this._packet(type, body);
    }
  }
  _packet(type, body) {
    if (type === 2) return this._onConnack && this._onConnack(body[1]);
    if (type === 9) { const id = (body[0] << 8) | body[1]; const w = this.waiters.get(id); if (w) { this.waiters.delete(id); w(); } return; }
    if (type === 3) { const tl = (body[0] << 8) | body[1]; const topic = dec.decode(body.subarray(2, 2 + tl)); if (this.onmessage) this.onmessage(topic, body.slice(2 + tl)); }
  }
}
