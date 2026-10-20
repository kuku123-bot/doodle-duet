// Direct connections: PeerJS (WebRTC data channels, free public signaling server). Adapted from Snug Isles' transport.
// PeerJS itself is vendored (vendor/peerjs.min.js) and loaded with a classic <script>, so it lives on window.peerjs.

export const ROOM_PREFIX = 'doodleduet-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to read out loud
export function makeCode(n = 5) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
export function parseCode(text) {
  const c = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 4 || c.length > 8) return null;
  for (const ch of c) if (!ALPHABET.includes(ch)) return null;
  return c;
}

// Only STUN servers that answered when Snug Isles probed them. Free public TURN relays are dead; strict networks use the
// encrypted MQTT relay (net/relay.js) instead.
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.nextcloud.com:443' },
];
// The address bar may only change servers when the app runs on this very computer (developing and testing).
const fromThisComputer = () => { try { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname) || localStorage.getItem('dd.devnet') === '1'; } catch (e) { return false; } };
function turnServer() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('turn') && fromThisComputer()) localStorage.setItem('dd.turn', JSON.stringify({ urls: q.get('turn'), username: q.get('turnuser') || undefined, credential: q.get('turncred') || undefined }));
    if (q.get('turn') === '' && fromThisComputer()) localStorage.removeItem('dd.turn');
    const t = JSON.parse(localStorage.getItem('dd.turn') || 'null');
    return t && t.urls ? t : null;
  } catch (e) { return null; }
}
const iceServers = () => { const t = turnServer(); return t ? [...ICE, t] : ICE; };

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: +(q.get('peerdebug') || 0), config: { iceServers: iceServers(), iceCandidatePoolSize: 2 } };
  if (q.get('peerhost') && fromThisComputer()) { o.host = q.get('peerhost'); o.port = +q.get('peerport') || 9000; o.path = q.get('peerpath') || '/'; o.secure = q.get('peersecure') === '1'; }
  return o;
}
function PeerCtor() {
  const P = window.peerjs && window.peerjs.Peer;
  if (!P) throw Object.assign(new Error('The connection library did not load. Check your internet and reload.'), { type: 'nolib' });
  return P;
}

class PeerConn {
  constructor(dc) {
    this.dc = dc; this.onmessage = null; this.onclose = null; this._closed = false;
    dc.on('data', (d) => { if (this.onmessage) this.onmessage(typeof d === 'string' ? d : new TextDecoder().decode(d)); });
    dc.on('close', () => this._fireClose());
    dc.on('error', () => this._fireClose());
  }
  _fireClose() { if (this._closed) return; this._closed = true; if (this.onclose) this.onclose(); }
  send(s) { this.dc.send(s); }
  close() { try { this.dc.close(); } catch (e) { /* ignore */ } this._fireClose(); }
  get open() { return this.dc.open && !this._closed; }
  get buffered() { return (this.dc.dataChannel && this.dc.dataChannel.bufferedAmount) || 0; }
  get lowRate() { return false; }
}

/** Try to own the room's id on the signaling server. Resolves the PeerJS peer; rejects with type 'taken' when somebody already hosts it. */
export function claimRoom(code, { onConnection, onStatus = () => {}, onLost = () => {} }) {
  return new Promise((resolve, reject) => {
    let settled = false, backoff = 1000, peer;
    try { peer = new (PeerCtor())(ROOM_PREFIX + code, peerOptions()); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { if (!settled) { settled = true; try { peer.destroy(); } catch (e) { /* ignore */ } reject(Object.assign(new Error('The matchmaking server did not answer.'), { type: 'network' })); } }, 12000);
    peer.on('open', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(peer); });
    peer.on('connection', (dc) => { dc.on('open', () => onConnection(new PeerConn(dc))); });
    peer.on('disconnected', () => {
      if (!settled || peer.destroyed) return;
      onStatus('Reconnecting to the matchmaking server…');
      const wait = backoff; backoff = Math.min(backoff * 2, 15000);
      setTimeout(() => { if (peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } }, wait);
    });
    peer.on('error', (err) => {
      if (!settled) {
        settled = true; clearTimeout(timer); try { peer.destroy(); } catch (e) { /* ignore */ }
        reject(Object.assign(new Error(err.message || String(err)), { type: err.type === 'unavailable-id' ? 'taken' : err.type }));
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'peer-unavailable'].includes(err.type)) return; // transient
      onLost(err);
    });
  });
}

function connectOnce(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let peer;
    try { peer = new (PeerCtor())(undefined, peerOptions()); } catch (e) { reject(e); return; }
    let done = false;
    const fail = (msg, type) => { if (done) return; done = true; clearTimeout(timer); try { peer.destroy(); } catch (x) { /* ignore */ } reject(Object.assign(new Error(msg), { type })); };
    const timer = setTimeout(() => fail('No answer from your partner.', 'timeout'), timeoutMs);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail('Nobody is in that room right now.', 'empty');
      else fail(['network', 'server-error', 'socket-error'].includes(err.type) ? 'Could not reach the matchmaking server.' : (err.message || String(err)), err.type || 'error');
    });
    peer.on('open', () => {
      const dc = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'raw' });
      if (!dc) return fail('Could not start the connection.', 'error');
      dc.on('open', () => { if (done) return; done = true; clearTimeout(timer); const c = new PeerConn(dc); c.peer = peer; const close = c.close.bind(c); c.close = () => { close(); setTimeout(() => { try { peer.destroy(); } catch (e) { /* ignore */ } }, 300); }; resolve(c); });
      dc.on('error', (e) => fail('Connection error: ' + (e.message || e), 'error'));
      const watch = () => {
        const pc = dc.peerConnection;
        if (!pc) { setTimeout(watch, 150); return; }
        let dis = null;
        pc.addEventListener('iceconnectionstatechange', () => {
          if (done) return;
          if (pc.iceConnectionState === 'failed') fail('A direct connection is not possible on this network.', 'ice');
          if (pc.iceConnectionState === 'disconnected' && !dis) dis = setTimeout(() => { if (!done && !dc.open) fail('The connection stalled.', 'ice'); }, 3500);
        });
      };
      watch();
    });
  });
}

/** Connect to whoever hosts the room. Retries once: WebRTC negotiation occasionally stalls on the first attempt. */
export async function connectToHost(code, { timeoutMs = 8000, attempts = 2 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try { return await connectOnce(code, timeoutMs); } catch (e) { last = e; if (e.type === 'empty' || e.type === 'nolib') break; }
  }
  throw last;
}
