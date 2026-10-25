// Servidor de avisos de Eventos: un Durable Object por rally (su «despertador» propio con alarmas).
import { DurableObject } from 'cloudflare:workers';
import { buildPush, importVapid } from './webpush.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O/0 ni I/1
const H24 = 24 * 3600e3, GRACE = 10 * 60e3, MAX_MS = 48 * 3600e3;
const MAX_SUBS = 10;   // ~0,6–0,8 ms de CPU por aviso: 10 dispositivos ≈ 6–8 ms, dentro de los 10 ms del plan gratuito
const MAX_EVENTS = 300;
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHA[b & 31]).join('');
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validCode = c => c.length === 6 && [...c].every(ch => ALPHA.includes(ch));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
let INSECURE = false; // solo pruebas locales: permite endpoints http://localhost
const okSub = s => s && typeof s.endpoint === 'string' && (/^https:\/\//.test(s.endpoint) || (INSECURE && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(s.endpoint))) && s.endpoint.length < 1000 && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
const str = (v, n) => typeof v === 'string' && v.length <= n;

function cors(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || 'https://blancolang-ai.github.io').split(',').map(s => s.trim());
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': o && allowed.includes(o) ? o : allowed[0], 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}

export default {
  async fetch(req, env) {
    INSECURE = env.DEV_INSECURE_PUSH === '1';
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const r = await route(req, env).catch(e => json({ error: 'server' }, 500));
    const out = new Response(r.body, r); for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
    return out;
  }
};
async function route(req, env) {
  const url = new URL(req.url), p = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && p[0] === 'vapid') return json({ key: env.VAPID_PUBLIC || null });
  if (p[0] !== 'rally') return json({ error: 'not_found' }, 404);
  const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
  if (req.method === 'POST' && !body) return json({ error: 'bad_json' }, 400);
  if (p.length === 1 && req.method === 'POST') { // crear: buscar un código libre
    for (let i = 0; i < 5; i++) {
      const code = newCode(), stub = env.RALLY.get(env.RALLY.idFromName(code));
      const res = await stub.create(code, body);
      if (res.status !== 409) return json(res.body, res.status);
    }
    return json({ error: 'busy' }, 503);
  }
  const code = normCode(p[1]);
  if (!validCode(code)) return json({ error: 'bad_code' }, 400);
  const stub = env.RALLY.get(env.RALLY.idFromName(code));
  const act = p[2] || 'state';
  if (req.method === 'GET' && act === 'state') { const r = await stub.state(); return json(r.body, r.status); }
  if (req.method === 'POST' && ['join', 'leave', 'pause', 'resume', 'finish'].includes(act)) { const r = await stub.act(act, body); return json(r.body, r.status); }
  return json({ error: 'not_found' }, 404);
}

export class Rally extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.now = () => Date.now(); INSECURE = env.DEV_INSECURE_PUSH === '1'; }
  async load() { return (await this.ctx.storage.get('r')) || null; }
  async put(r) { await this.ctx.storage.put('r', r); }
  pub(r) { // lo que ve cualquier dispositivo con el código (sin token ni suscripciones)
    return { code: r.code, serverNow: this.now(), startTs: r.startTs, durationMs: r.durationMs, pausedTotal: r.pausedTotal, pausedAt: r.pausedAt, cfg: r.cfg, events: r.events, finished: false };
  }
  elapsed(r, now = this.now()) { return now - r.startTs - r.pausedTotal - (r.pausedAt ? now - r.pausedAt : 0); }
  async create(code, b) {
    if (await this.load()) return { status: 409, body: { error: 'taken' } };
    const d = b.durationMs, ev = b.events;
    if (!Number.isFinite(d) || d <= 0 || d > MAX_MS || !Array.isArray(ev) || ev.length > MAX_EVENTS
      || !ev.every(e => e && str(e.id, 40) && Number.isFinite(e.at) && e.at >= 0 && e.at <= d && str(e.text, 120) && str(e.label, 60) && str(e.icon, 20) && Number.isInteger(e.tramo))
      || !b.cfg || ![3, 4, 5].includes(b.cfg.tramos)) return { status: 400, body: { error: 'bad_rally' } };
    const now = this.now(), age = Math.min(Math.max(0, +b.elapsedMs || 0), d); // el anfitrión empezó hace «age» ms
    const token = hex(crypto.getRandomValues(new Uint8Array(16)));
    const events = ev.map(e => ({ id: e.id, at: e.at, text: e.text, label: e.label, icon: e.icon, kind: e.kind, tramo: e.tramo, level: e.level })).sort((a, c) => a.at - c.at);
    const r = { code, tokenHash: await sha(token), createdAt: now, startTs: now - age, durationMs: d, pausedTotal: 0, pausedAt: null,
      cfg: { tramos: b.cfg.tramos, type: b.cfg.type, freq: b.cfg.freq, intensity: b.cfg.intensity }, events, sent: 0, subs: [] };
    if (okSub(b.sub)) r.subs.push({ endpoint: b.sub.endpoint, keys: b.sub.keys });
    // descartar los que ya vencieron (no se avisa del pasado)
    while (r.sent < r.events.length && r.events[r.sent].at <= this.elapsed(r, now)) r.sent++;
    await this.put(r); await this.schedule(r);
    return { status: 200, body: { ...this.pub(r), token } };
  }
  async state() { const r = await this.load(); return r ? { status: 200, body: this.pub(r) } : { status: 404, body: { error: 'gone' } }; }
  async act(act, b) {
    const r = await this.load();
    if (!r) return { status: 404, body: { error: 'gone' } };
    if (act === 'join' || act === 'leave') {
      if (!okSub(b.sub)) return act === 'join' ? { status: 200, body: this.pub(r) } : { status: 400, body: { error: 'bad_sub' } };
      r.subs = r.subs.filter(s => s.endpoint !== b.sub.endpoint);
      if (act === 'join') { if (r.subs.length >= MAX_SUBS) return { status: 429, body: { ...this.pub(r), error: 'full' } }; r.subs.push({ endpoint: b.sub.endpoint, keys: b.sub.keys }); }
      await this.put(r); return { status: 200, body: this.pub(r) };
    }
    // solo el dispositivo creador (con el token) controla el rally
    if (typeof b.token !== 'string' || await sha(b.token) !== r.tokenHash) return { status: 403, body: { error: 'forbidden' } };
    const now = this.now(), at = Number.isFinite(b.at) ? Math.min(now, Math.max(b.at, r.startTs)) : now; // «at» = hora (del servidor) en que se pulsó, para reintentos sin conexión
    if (act === 'finish') { await this.wipe(); return { status: 200, body: { finished: true } }; }
    if (act === 'pause' && !r.pausedAt) r.pausedAt = at;
    if (act === 'resume' && r.pausedAt) { r.pausedTotal += Math.max(0, at - r.pausedAt); r.pausedAt = null; }
    await this.put(r); await this.schedule(r);
    return { status: 200, body: this.pub(r) };
  }
  async wipe() { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
  // Próximo despertador: siguiente evento (si no está en pausa), el final del rally + margen, o la caducidad de 24 h.
  async schedule(r) {
    const exp = r.createdAt + H24, cand = [exp];
    if (!r.pausedAt) {
      if (r.sent < r.events.length) cand.push(r.startTs + r.pausedTotal + r.events[r.sent].at);
      cand.push(r.startTs + r.pausedTotal + r.durationMs + GRACE);
    }
    await this.ctx.storage.setAlarm(Math.min(...cand));
  }
  async alarm() {
    const r = await this.load(); if (!r) return;
    const now = this.now();
    if (now >= r.createdAt + H24 || (!r.pausedAt && this.elapsed(r, now) >= r.durationMs + GRACE)) return this.wipe(); // borrado automático
    const due = [];
    if (!r.pausedAt) while (r.sent < r.events.length && r.events[r.sent].at <= this.elapsed(r, now) + 500) due.push(r.events[r.sent++]);
    if (due.length) r.subs = await this.send(r, due);
    await this.put(r); await this.schedule(r);
  }
  // Un solo aviso por dispositivo aunque venzan varios eventos a la vez. Devuelve las suscripciones vivas (404/410 = borrar).
  async send(r, due) {
    const vapid = this.vapid || (this.vapid = { key: await importVapid(this.env.VAPID_PUBLIC, this.env.VAPID_PRIVATE), pub: this.env.VAPID_PUBLIC, subject: this.env.VAPID_SUBJECT || 'mailto:eventos@example.invalid' });
    const last = due.at(-1), multi = due.length > 1;
    const payload = JSON.stringify({ code: r.code, ids: due.map(e => e.id), kind: multi ? 'multi' : last.kind,
      title: multi ? due.length + ' eventos: ' + due.map(e => e.text).join(', ') : last.text, at: last.at });
    const cache = new Map();
    const res = await Promise.all(r.subs.map(async s => {
      try { const resp = await (this.fetchPush || fetch)(await buildPush(s, payload, vapid, cache)); return [404, 410].includes(resp.status) ? null : s; }
      catch { return s; }
    }));
    return res.filter(Boolean);
  }
}
