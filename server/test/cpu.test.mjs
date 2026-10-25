// Medición de CPU por aviso (ECDH + HKDF + AES-GCM + firma VAPID) frente al límite de 10 ms del plan gratuito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPush, importVapid, b64u } from '../src/webpush.js';
test('CPU por aviso: 10 dispositivos caben en 10 ms', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), key = await importVapid(pub, (await crypto.subtle.exportKey('jwk', kp.privateKey)).d);
  const u = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', u.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
  const v = { key, pub, subject: 'mailto:a@b.c' };
  for (let i = 0; i < 50; i++) await buildPush(sub, 'x'.repeat(150), v);
  // mejor de 5 tandas (el peor caso: firma VAPID nueva en cada aviso); en el alarm real la firma se reutiliza por servicio push
  let ms = Infinity;
  for (let k = 0; k < 5; k++) { const N = 100, c0 = process.cpuUsage();
    for (let i = 0; i < N; i++) await buildPush(sub, 'x'.repeat(150), { key, pub: v.pub, subject: 'mailto:a@b.c' });
    const cu = process.cpuUsage(c0); ms = Math.min(ms, (cu.user + cu.system) / 1000 / N); }
  console.log(`  CPU por aviso (con firma VAPID): ${ms.toFixed(2)} ms`);
  assert.ok(ms * 10 < 10, 'los 10 dispositivos máx. deben caber en 10 ms');
});
