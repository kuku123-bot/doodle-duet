// Saved drawings and your own inspiration photos live in this device's IndexedDB. Every drawing autosaves; the gallery
// lists them. (Nothing leaves the device except what is sent to your partner while you draw together.)
const DB = 'doodle-duet', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const store = {
  async saveDoc(data, thumb) {
    await tx('docs', 'readwrite', (s) => { s.put(data); });
    if (thumb) await tx('thumbs', 'readwrite', (s) => { s.put({ id: data.id, title: data.title || '', updated: data.updated || Date.now(), created: data.created, n: (data.ops || []).length, w: data.w, h: data.h, mode: data.mode && data.mode.id, thumb }); });
  },
  loadDoc: (id) => tx('docs', 'readonly', (s) => req(s.get(id))),
  async deleteDoc(id) { await tx('docs', 'readwrite', (s) => { s.delete(id); }); await tx('thumbs', 'readwrite', (s) => { s.delete(id); }); },
  async listDocs() { const all = await tx('thumbs', 'readonly', (s) => req(s.getAll())); return (all || []).sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
  savePhoto: (p) => tx('photos', 'readwrite', (s) => { s.put(p); }),
  async listPhotos() { const all = await tx('photos', 'readonly', (s) => req(s.getAll())); return (all || []).sort((a, b) => (b.created || 0) - (a.created || 0)); },
  deletePhoto: (id) => tx('photos', 'readwrite', (s) => { s.delete(id); }),
};

const LS = 'dd.';
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* private mode / full */ } },
};
