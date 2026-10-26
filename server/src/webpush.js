// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) solo con WebCrypto: sin dependencias.
const te = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
// Cifra el contenido para una suscripción { endpoint, keys: { p256dh, auth } }.
export async function encrypt(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  if (uaPub.length !== 65 || auth.length !== 16) throw new Error('bad keys');
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([65]), asPub, ct);
}
// Clave VAPID: pública en bruto (65 bytes, b64url) y privada «d» (32 bytes, b64url).
export async function importVapid(pub, priv) {
  const p = unb64u(pub);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: priv, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
export async function vapidJWT(key, aud, sub, now = Date.now()) {
  const h = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + c));
  return h + '.' + c + '.' + b64u(sig);
}
// Prepara la petición (sin enviarla) para poder medirla y probarla.
export async function buildPush(sub, payload, vapid, jwtCache = new Map(), ttl = 600) {
  const aud = new URL(sub.endpoint).origin;
  let jwt = jwtCache.get(aud);
  if (!jwt) { jwt = await vapidJWT(vapid.key, aud, vapid.subject); jwtCache.set(aud, jwt); }
  const body = await encrypt(sub, payload);
  return new Request(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high',
    Authorization: `vapid t=${jwt}, k=${vapid.pub}` } });
}
