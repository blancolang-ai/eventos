// Genera un par de claves VAPID en .dev.vars (ignorado por git). La privada NUNCA se sube al repositorio.
import { writeFileSync, existsSync } from 'node:fs';
const b64u = b => Buffer.from(b).toString('base64url');
if (existsSync('.dev.vars') && !process.argv.includes('--force')) { console.log('.dev.vars ya existe (usa --force para regenerar)'); process.exit(0); }
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), d = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
writeFileSync('.dev.vars', `VAPID_PUBLIC=${pub}\nVAPID_PRIVATE=${d}\nVAPID_SUBJECT=mailto:eventos@example.invalid\nALLOWED_ORIGINS=https://blancolang-ai.github.io,http://localhost:4317\n`, { mode: 0o600 });
console.log('Clave pública VAPID:', pub);
