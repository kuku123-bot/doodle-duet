// The "backup code" (relay key): tiny helpers with no dependencies, so the menus can use them without loading the relay itself.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to read out loud
export const KEY_LEN = 16; // 16 symbols x 5 bits = 80 bits of secret
export function makeRelayKey() {
  const a = new Uint8Array(KEY_LEN); crypto.getRandomValues(a);
  return [...a].map((b) => ALPHABET[b & 31]).join('');
}
export const formatRelayKey = (k) => (k || '').replace(/(.{4})(?=.)/g, '$1-');
/** accepts what people paste or type ("abcd efgh…", with dashes…); returns the normalised key or null */
export function parseRelayKey(text) {
  const k = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.length !== KEY_LEN) return null;
  for (const ch of k) if (!ALPHABET.includes(ch)) return null;
  return k;
}
