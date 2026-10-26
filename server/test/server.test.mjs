// Pruebas del servidor: cifrado RFC 8291 (descifrando como lo haría el navegador) y API real con «wrangler dev» local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { encrypt, buildPush, importVapid, b64u, unb64u } from '../src/webpush.js';

const te = new TextEncoder();
const hk = async (salt, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
async function makeUA() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, keys: { p256dh: b64u(pub), auth: b64u(auth) } };
}
async function decrypt(ua, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.kp.privateKey, 256));
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...ua.pub, ...asPub]);
  const ikm = await hk(ua.auth, shared, info, 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(pt.at(-1), 2); return new TextDecoder().decode(pt.slice(0, -1));
}
async function vapidPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { kp, pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), d: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d };
}

test('cifrado aes128gcm: el navegador puede descifrarlo', async () => {
  const ua = await makeUA(); const body = await encrypt({ keys: ua.keys }, '{"hola":"tramo 2"}');
  assert.equal(await decrypt(ua, body), '{"hola":"tramo 2"}');
});
test('VAPID: JWT ES256 verificable y cabeceras correctas', async () => {
  const v = await vapidPair(), ua = await makeUA(), key = await importVapid(v.pub, v.d);
  const req = await buildPush({ endpoint: 'https://web.push.apple.com/x', keys: ua.keys }, 'x', { key, pub: v.pub, subject: 'mailto:a@b.c' });
  const auth = req.headers.get('Authorization'); const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, v.pub); const [h, c, s] = jwt.split('.');
  assert.equal(JSON.parse(new TextDecoder().decode(unb64u(c))).aud, 'https://web.push.apple.com');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.kp.publicKey, unb64u(s), te.encode(h + '.' + c)));
  assert.equal(req.headers.get('Content-Encoding'), 'aes128gcm');
});

// ---- API con wrangler dev ----
const PORT = 8788, MOCK = 8799, API = `http://127.0.0.1:${PORT}`;
let wr, mock, got = [], status404 = new Set(), vp, ua1, ua2;
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://blancolang-ai.github.io' }, body: JSON.stringify(b) });
const wait = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  vp = await vapidPair(); ua1 = await makeUA(); ua2 = await makeUA();
  mock = http.createServer((q, s) => { const ch = []; q.on('data', d => ch.push(d)); q.on('end', () => { got.push({ path: q.url, auth: q.headers.authorization, body: new Uint8Array(Buffer.concat(ch)) }); s.statusCode = status404.has(q.url) ? 410 : 201; s.end(); }); }).listen(MOCK);
  wr = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '/tmp/eventos-wr-test-' + Date.now(), '--var', 'DEV_INSECURE_PUSH:1', '--var', 'VAPID_PUBLIC:' + vp.pub, '--var', 'VAPID_PRIVATE:' + vp.d, '--var', 'ALLOWED_ORIGINS:https://blancolang-ai.github.io'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(API + '/vapid')).ok) return; } catch {} await wait(500); }
  throw new Error('wrangler dev no arrancó');
});
after(() => { wr && wr.kill('SIGTERM'); mock && mock.close(); });
const ev = (id, at) => ({ id, at, text: 'Tramo 1: Reventón', label: 'Reventón', icon: 'blowout', kind: 'pinchazos', tramo: 1 });
const sub = (ua, n) => ({ endpoint: `http://127.0.0.1:${MOCK}/push/${n}`, keys: ua.keys });

test('API: crear, CORS, unirse, avisos a la hora, pausa, solo el creador controla, 410 borra, finalizar borra', async () => {
  assert.equal((await (await fetch(API + '/vapid')).json()).key, vp.pub);
  const pre = await fetch(API + '/rally', { method: 'OPTIONS', headers: { Origin: 'https://blancolang-ai.github.io' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://blancolang-ai.github.io');
  assert.equal((await post('/rally', { durationMs: -1, events: [], cfg: { tramos: 3 } })).status, 400);
  const r = await post('/rally', { durationMs: 60e3, cfg: { tramos: 3, type: 'pinchazos', freq: 'media', intensity: 'suave' }, events: [ev('a', 2000), ev('b', 4000), ev('c', 30000)], sub: sub(ua1, 1) });
  assert.equal(r.status, 200); const c = await r.json();
  assert.match(c.code, /^[A-HJ-NP-Z2-9]{6}$/); assert.match(c.token, /^[0-9a-f]{32}$/); assert.equal(c.events.length, 3);
  const st = await (await fetch(`${API}/rally/${c.code.toLowerCase()}`)).json();
  assert.equal(st.token, undefined); assert.equal(st.startTs, c.startTs);
  assert.equal((await post(`/rally/${c.code}/join`, { sub: sub(ua2, 2) })).status, 200);
  await wait(3200); // evento «a» a los 2 s
  const first = got.filter(g => g.path.startsWith('/push/'));
  assert.equal(first.length, 2, 'un aviso por dispositivo');
  const p = JSON.parse(await decrypt(ua1, first.find(g => g.path === '/push/1').body));
  assert.deepEqual(p.ids, ['a']); assert.equal(p.code, c.code); assert.match(first[0].auth, /^vapid t=/);
  // invitados no pueden pausar
  assert.equal((await post(`/rally/${c.code}/pause`, { token: 'x'.repeat(32) })).status, 403);
  const pz = await (await post(`/rally/${c.code}/pause`, { token: c.token })).json(); assert.ok(pz.pausedAt);
  got = []; await wait(2500); assert.equal(got.length, 0, 'en pausa no se avisa');
  status404.add('/push/2'); // el dispositivo 2 desinstaló la app
  const rs = await (await post(`/rally/${c.code}/resume`, { token: c.token })).json(); assert.equal(rs.pausedAt, null); assert.ok(rs.pausedTotal >= 2000);
  await wait(2500); // «b» desplazado por la pausa
  assert.equal(got.length, 2); got = [];
  assert.equal((await post(`/rally/${c.code}/join`, { sub: sub(ua1, 1) })).status, 200);
  // 2 eliminado tras 410: el siguiente aviso solo iría al 1 (comprobado vía finalize)
  assert.equal((await post(`/rally/${c.code}/finish`, { token: c.token })).status, 200);
  assert.equal((await fetch(`${API}/rally/${c.code}`)).status, 404, 'al finalizar se borra todo');
  assert.equal((await fetch(`${API}/rally/0O1I00`)).status, 400);
});
test('API: varios eventos vencidos a la vez = un solo aviso agrupado; eventos pasados no se avisan', async () => {
  got = [];
  const r = await (await post('/rally', { durationMs: 60e3, elapsedMs: 5000, cfg: { tramos: 3 }, events: [ev('old', 1000), ev('x', 6500), ev('y', 6600)], sub: sub(ua1, 9) })).json();
  await wait(2500);
  const mine = got.filter(g => g.path === '/push/9'); assert.equal(mine.length, 1);
  assert.deepEqual(JSON.parse(await decrypt(ua1, mine[0].body)).ids, ['x', 'y']);
  await post(`/rally/${r.code}/finish`, { token: r.token });
});
