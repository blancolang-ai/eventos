'use strict';
// ===== Configuración =====
const MIN = 60000;
const MAX_MS = 48 * 60 * MIN; // duración máxima: exactamente 48:00
// Frecuencia = nº TOTAL de eventos en todo el rally, elegido al azar al empezar (ambos extremos incluidos).
// Los rangos se pueden cambiar en Ajustes (localStorage); «aleatoria» va del mínimo de Baja al máximo de Alta.
const FREQ_DEFAULT = { baja: [0, 2], media: [1, 3], alta: [2, 4] };
const FREQ_STORE = 'eventos.freq.v1';
const LEVELS = ['baja', 'media', 'alta'];
function validFreq(f) {
  return !!f && LEVELS.every(k => Array.isArray(f[k]) && f[k].length === 2 && f[k].every(n => Number.isInteger(n) && n >= 0 && n <= 99) && f[k][0] <= f[k][1])
    && f.baja[0] <= f.media[0] && f.media[0] <= f.alta[0] && f.baja[1] <= f.media[1] && f.media[1] <= f.alta[1];
}
let FREQ = (() => { try { const f = JSON.parse(localStorage.getItem(FREQ_STORE)); if (validFreq(f)) return f; } catch {} return structuredClone(FREQ_DEFAULT); })();
const freqRange = f => f === 'aleatoria' ? [FREQ.baja[0], FREQ.alta[1]] : (FREQ[f] || FREQ.media);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORE = 'eventos.race.v1';
const SNOW = { suave: 'Nevada suave', moderada: 'Nevada moderada', intensa: 'Nevada intensa' }; // nieve = harina en pista
const SLOW_P = { suave: 0.8, moderada: 0.55, intensa: 0.25, aleatoria: 0.5 }; // prob. de «Pinchazo lento» frente a «Reventón»
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];
// Calendario de eventos: N al azar según la frecuencia; la duración se divide en N+1 segmentos
// y cada evento cae con jitter (±40 % de segmento) alrededor de su marca, sin tocar ni el inicio ni el final.
function schedule(freq, durationMs, r = Math.random) {
  const [a, b] = freqRange(freq), lo = Math.min(a, b), hi = Math.max(a, b);
  const n = lo + Math.floor(r() * (hi - lo + 1)), seg = durationMs / (n + 1);
  return Array.from({ length: n }, (_, i) => Math.round(seg * (i + 1 + (r() - 0.5) * 0.8)));
}
// Los eventos no tienen duración: solo se anuncian.
function makeEvent(cfg, r = Math.random) {
  const nt = [3, 4, 5].includes(cfg.tramos) ? cfg.tramos : 3;
  const tramo = 1 + Math.min(nt - 1, Math.floor(r() * nt)); // siempre un tramo válido
  const kind = cfg.type === 'ambos' ? (r() < 0.6 ? 'clima' : 'pinchazos') : cfg.type;
  let ev;
  if (kind === 'pinchazos') {
    const slow = r() < SLOW_P[cfg.intensity];
    ev = { kind, icon: slow ? 'slow' : 'blowout', label: slow ? 'Pinchazo lento' : 'Reventón' };
  } else {
    const lvl = cfg.intensity === 'aleatoria' ? pick(Object.keys(SNOW), r) : cfg.intensity;
    ev = { kind, icon: 'snow', label: SNOW[lvl], level: lvl };
  }
  return { ...ev, tramo, text: `Tramo ${tramo}: ${ev.label}` };
}

// ===== Iconos SVG =====
const SVG = p => `<svg viewBox="0 0 48 48" class="ico" aria-hidden="true">${p}</svg>`;
const FLAKE = '<g stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><path d="M24 4v40M6.7 14l34.6 20M6.7 34l34.6-20"/><path d="M18 7l6 5 6-5M18 41l6-5 6 5M5 21l8 0-3-7M43 27l-8 0 3 7M5 27l8 0-3 7M43 21l-8 0 3-7"/></g>';
const TYRE = '<circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="24" cy="24" r="6" fill="currentColor"/>';
const ICONS = {
  snow: SVG(FLAKE),
  slow: SVG(TYRE + '<path d="M34 36q6 4 10 2" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  blowout: SVG(TYRE + '<path d="M38 6l3 7 6-2-4 6 5 4-7 1 1 7-5-5" fill="#ff5a3c"/>'),
  road: SVG('<path d="M2 38l14-22 8 10 8-14 14 26z" fill="currentColor" opacity=".35"/><path d="M14 46c6-8 22-6 18-16s-12-6-6-14" stroke="currentColor" stroke-width="4" fill="none" stroke-dasharray="4 4" stroke-linecap="round"/>'),
  finish: SVG('<path d="M4 40l14-24 8 11 7-11 11 24z" fill="currentColor"/><path d="M14 23l4-7 4 6M29 18l4-2 3 6" fill="#fff"/>')
};
const ic = k => ICONS[k] || ICONS.road; // solo iconos conocidos (los datos guardados no se insertan como HTML)

// ===== Estado (basado en marcas de tiempo) =====
let S = null;
const save = () => S ? localStorage.setItem(STORE, JSON.stringify(S)) : localStorage.removeItem(STORE);
function validState(s) {
  const nt = s && s.cfg && s.cfg.tramos;
  return !!s && typeof s === 'object' && s.cfg && typeof s.cfg === 'object' && [3, 4, 5].includes(nt)
    && [s.startTs, s.durationMs, s.pausedTotal].every(Number.isFinite) && s.durationMs > 0 && s.durationMs <= MAX_MS && s.pausedTotal >= 0
    && (s.pausedAt == null || Number.isFinite(s.pausedAt))
    && Array.isArray(s.events) && s.events.every(e => e && typeof e === 'object' && Number.isFinite(e.at) && e.at >= 0
      && Number.isInteger(e.tramo) && e.tramo >= 1 && e.tramo <= nt && typeof e.text === 'string' && typeof e.label === 'string')
    && (s.schedule == null || (Array.isArray(s.schedule) && s.schedule.every(Number.isFinite)))
    && (s.plan == null || (Array.isArray(s.plan) && s.plan.every(e => e && typeof e.id === 'string' && Number.isFinite(e.at) && e.at >= 0
      && Number.isInteger(e.tramo) && e.tramo >= 1 && e.tramo <= nt && typeof e.text === 'string' && typeof e.label === 'string')))
    && (s.sync == null || (typeof s.sync === 'object' && ['host', 'guest'].includes(s.sync.role)));
}
const load = () => { try { const s = JSON.parse(localStorage.getItem(STORE)); return validState(s) ? s : null; } catch { return null; } };
function raceElapsed(now = Date.now()) {
  if (!S) return 0;
  return now - S.startTs - S.pausedTotal - (S.pausedAt ? now - S.pausedAt : 0);
}
function startRace(cfg, now = Date.now()) {
  const times = (window.__EVENTOS_TEST_TIMES || schedule)(cfg.freq, cfg.durationMs);
  // 2.0.0: el contenido de cada evento se decide al empezar (para poder enviarlo al servidor de avisos)
  const plan = times.map((at, i) => ({ id: 'e' + (i + 1), ...makeEvent(cfg), at }));
  S = { cfg, startTs: now, durationMs: cfg.durationMs, pausedTotal: 0, pausedAt: null, events: [],
        schedule: times, plan, finished: false, sync: { role: 'host', status: 'pending' } };
  save();
}
function pause(now = Date.now()) { if (S && !S.pausedAt) { S.pausedAt = now; save(); } }
function resume(now = Date.now()) { if (S && S.pausedAt) { S.pausedTotal += now - S.pausedAt; S.pausedAt = null; save(); } }
// Dispara todos los eventos vencidos (incluye los ocurridos con la app oculta).
function catchUp(now = Date.now()) {
  if (!S || S.finished) return [];
  const el = raceElapsed(now), fired = [];
  if (!S.schedule) S.schedule = schedule(S.cfg.freq, S.durationMs); // rally guardado por una versión anterior
  // el calendario manda: si no coincide con el plan (estado antiguo o editado), se rehace el contenido de los eventos aún no ocurridos
  if (S.plan && !S.sync?.code && (S.plan.length !== S.schedule.length || S.plan.some((e, i) => e.at !== S.schedule[i])))
    S.plan = S.schedule.map((at, i) => i < S.events.length ? { ...S.events[i], id: S.events[i].id || 'e' + (i + 1) } : { id: 'e' + (i + 1), ...makeEvent(S.cfg), at });
  if (S.plan) { // 2.0.0: eventos precalculados (con id para no repetir aviso local + push)
    while (S.events.length < S.plan.length && S.plan[S.events.length].at <= el) { const ev = { ...S.plan[S.events.length] }; S.events.push(ev); fired.push(ev); }
  } else while (S.events.length < S.schedule.length && S.schedule[S.events.length] <= el) {
    const at = S.schedule[S.events.length];
    const ev = { ...makeEvent(S.cfg), at }; // 'at' = tiempo de carrera
    S.events.push(ev); fired.push(ev);
  }
  if (el >= S.durationMs) { S.finished = true; if (wakeLock) setWake(false); $('#wakeToggle').checked = false; }
  if (fired.length || S.finished) save();
  return fired;
}

// ===== Alertas =====
let audioCtx = null, wakeLock = null;
function alarm() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    const t0 = audioCtx.currentTime, g = audioCtx.createGain();
    g.gain.value = 0.9; g.connect(audioCtx.destination);
    for (let i = 0; i < 6; i++) {
      const o = audioCtx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(i % 2 ? 660 : 990, t0 + i * 0.3);
      o.connect(g); o.start(t0 + i * 0.3); o.stop(t0 + i * 0.3 + 0.25);
    }
  } catch (e) { /* sin audio */ }
}
// Misma etiqueta que el aviso push (sw.js) para que nunca salgan dos notificaciones del mismo evento.
const evTag = ev => ev.id && S && S.sync && S.sync.code ? 'ev-' + S.sync.code + '-' + ev.id : 'eventos-' + (S ? S.startTs : 0) + '-' + ev.at + '-' + (ev.n || 1);
async function notify(ev) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
  try {
    const reg = await navigator.serviceWorker.ready, tag = evTag(ev);
    if (ev.id && reg.getNotifications && (await reg.getNotifications({ tag })).length) return; // ya avisado por push
    await reg.showNotification((ev.kind === 'pinchazos' ? '🛞 ' : ev.kind === 'clima' ? '❄ ' : '⚠ ') + ev.text, { body: 'Tiempo de rally ' + fmt(ev.at), icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png', tag, renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 800] });
  } catch (e) { /* ignore */ }
}
function alertEvents(evs) {
  if (!evs.length) return;
  alarm();
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
  notify(evs.length > 1 ? { text: evs.length + ' eventos: ' + evs.map(e => e.text).join(', '), at: evs.at(-1).at, n: evs.length, id: evs.at(-1).id } : evs[0]);
  const c = $('#current'); c.classList.remove('alert'); void c.offsetWidth; c.classList.add('alert');
}
async function setWake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { $('#wakeToggle').checked = false; }
}

// ===== 2.0.0: avisos push y rally compartido (servidor Cloudflare) =====
// Dirección del servidor: <meta name="push-api"> (vacía = sin servidor, todo local como en 1.x). Las pruebas la cambian con localStorage.
const API_LS = localStorage.getItem('eventos.api');
const API = (API_LS === 'off' ? '' : (API_LS || (document.querySelector('meta[name=push-api]') || {}).content || '')).replace(/\/$/, '');
const PUSH_STORE = 'eventos.push.v1', FIN_STORE = 'eventos.finish.v1';
const pushOn = () => localStorage.getItem(PUSH_STORE) !== '0'; // «Avisos con pantalla bloqueada»: activado por defecto
const fmtCode = c => c ? c.slice(0, 3) + '-' + c.slice(3) : '';
async function api(path, body, timeout = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout), t0 = Date.now();
  try {
    const r = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, keepalive: path.endsWith('/finish') } : { signal: ctl.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (Number.isFinite(j.serverNow)) j.off = j.serverNow - (t0 + Date.now()) / 2; // diferencia de reloj servidor − este dispositivo
    return { status: r.status, j };
  } catch { return { status: 0, j: {} }; } finally { clearTimeout(t); }
}
const urlB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
// Suscripción push de este dispositivo (null si no hay permiso, interruptor apagado o el navegador no lo admite).
// Nunca bloquea el rally: si el navegador tarda en suscribirse, se sigue sin push (con alarma local).
const getSub = () => Promise.race([getSub0(), new Promise(r => setTimeout(() => r(null), 8000))]);
async function getSub0() {
  if (!API || !pushOn() || !('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { j } = await api('/vapid'); if (!j.key) return null;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(j.key) });
    }
    return sub.toJSON();
  } catch { return null; }
}
// Copia el estado del servidor (reloj del servidor → reloj de este dispositivo).
function adopt(st) {
  const off = st.off || 0, sy = S.sync;
  sy.off = off; S.startTs = st.startTs - off; S.pausedTotal = st.pausedTotal; S.pausedAt = st.pausedAt == null ? null : st.pausedAt - off;
}
async function hostCreate() {
  if (!S || !S.sync || S.sync.role !== 'host' || S.sync.code || S.finished || !API || hostCreate.busy) return;
  hostCreate.busy = true;
  try {
    const sub = await getSub();
    const { status, j } = await api('/rally', { durationMs: S.durationMs, elapsedMs: raceElapsed(), cfg: S.cfg, events: S.plan, sub });
    if (!S || !S.sync || S.sync.role !== 'host' || S.sync.code) return;
    if (status === 200 && j.code) {
      const paused = S.pausedAt; S.sync = { role: 'host', code: j.code, token: j.token, off: j.off, pending: [], status: 'ok', subOk: !!sub };
      // conservar el tiempo local (el servidor empezó al recibir la petición) y comunicar una pausa hecha mientras tanto
      if (paused) S.sync.pending.push({ act: 'pause', at: Date.now() + j.off });
      save(); flush();
    } else { S.sync.status = 'local'; save(); }
  } finally { hostCreate.busy = false; render(); }
}
// Pausa / reanudar / finalizar del creador: se aplican al momento y se envían en orden (con reintento si no hay conexión).
function queue(act) {
  if (!S || !S.sync || S.sync.role !== 'host') return;
  if (!S.sync.code) return hostCreate(); // aún sin código: se enviará el estado al crearlo
  S.sync.pending = (S.sync.pending || []).concat({ act, at: Date.now() + (S.sync.off || 0) }); save(); flush();
}
async function flush() {
  const sy = S && S.sync; if (!sy || !sy.code || flush.busy || !(sy.pending || []).length) return;
  flush.busy = true;
  try {
    while (S && S.sync === sy && sy.pending.length) {
      const op = sy.pending[0], { status, j } = await api(`/rally/${sy.code}/${op.act}`, { token: sy.token, at: op.at });
      if (status === 200) { sy.pending.shift(); sy.status = 'ok'; if (S.sync === sy && !sy.pending.length) adopt(j); }
      else if (status === 404 || status === 403) { sy.pending = []; sy.status = 'local'; } // caducado en el servidor: seguir solo en local
      else { sy.status = 'offline'; break; }
      save();
    }
  } finally { flush.busy = false; render(); }
}
// Finalizar: se borra en el servidor. Si no hay conexión, se recuerda y se reintenta al volver.
function finishRemote(sy) {
  if (!sy || !API) return;
  if (sy.role === 'guest') { getSub().then(sub => sub && api(`/rally/${sy.code}/leave`, { sub })); return; }
  if (!sy.code) return;
  localStorage.setItem(FIN_STORE, JSON.stringify({ code: sy.code, token: sy.token }));
  retryFinish();
}
async function retryFinish() {
  let f; try { f = JSON.parse(localStorage.getItem(FIN_STORE)); } catch {} if (!f || !API) return;
  const { status } = await api(`/rally/${f.code}/finish`, { token: f.token });
  if (status === 200 || status === 404 || status === 403) localStorage.removeItem(FIN_STORE);
}
// Invitado: unirse con el código (solo ver; no puede pausar ni finalizar).
async function joinRally(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return 'El código tiene 6 letras o números (sin O, 0, I ni 1).';
  if (!API) return 'Rallies compartidos no disponibles en esta versión.';
  if ('Notification' in window && Notification.permission === 'default' && pushOn()) await Notification.requestPermission().catch(() => {});
  const sub = await getSub();
  const { status, j } = await api(`/rally/${code}/join`, { sub });
  if (status === 0) return 'Sin conexión: hace falta internet para unirse a un rally.';
  if (status === 404) return 'No existe ningún rally con ese código (o ya ha terminado).';
  if (status !== 200 && status !== 429) return 'No se pudo unir al rally. Inténtalo de nuevo.';
  const cfg = { ...j.cfg, durationMs: j.durationMs };
  S = { cfg, startTs: 0, durationMs: j.durationMs, pausedTotal: 0, pausedAt: null, events: [], schedule: j.events.map(e => e.at), plan: j.events,
        finished: false, sync: { role: 'guest', code, off: 0, status: 'ok', subOk: !!sub && status === 200, full: status === 429 } };
  adopt(j);
  // lo que ya pasó antes de unirse aparece en el historial, sin alarma
  const el = raceElapsed(); while (S.events.length < S.plan.length && S.plan[S.events.length].at <= el) S.events.push({ ...S.plan[S.events.length] });
  save(); return '';
}
async function pollGuest() {
  const sy = S && S.sync; if (!sy || sy.role !== 'guest' || S.finished || pollGuest.busy) return;
  pollGuest.busy = true;
  try {
    const { status, j } = await api(`/rally/${sy.code}`);
    if (!S || S.sync !== sy) return;
    if (status === 200) { adopt(j); sy.status = 'ok'; }
    else if (status === 404) { S.finished = true; sy.status = 'gone'; } // el organizador lo ha finalizado
    else sy.status = 'offline';
    save(); render();
  } finally { pollGuest.busy = false; }
}
// Al abrir la app: renovar la suscripción (iOS puede perderla) y volver a darla de alta en el rally.
async function resubscribe() {
  const sy = S && S.sync; if (!sy || !sy.code || S.finished) return;
  const sub = await getSub();
  if (!S || S.sync !== sy) return;
  if (sub) { const { status, j } = await api(`/rally/${sy.code}/join`, { sub }); if (status === 200) { sy.subOk = true; if (sy.role === 'guest') adopt(j); } else if (status === 429) sy.full = true; }
  else sy.subOk = false;
  save(); render();
}
async function setPush(on) {
  localStorage.setItem(PUSH_STORE, on ? '1' : '0');
  for (const id of ['#pushToggle', '#pushToggleRace']) $(id).checked = on;
  const sy = S && S.sync;
  if (on) { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {}); resubscribe(); }
  else if (sy && sy.code) { const sub = await getSubRaw(); if (sub) api(`/rally/${sy.code}/leave`, { sub }); sy.subOk = false; save(); }
  render();
}
async function getSubRaw() { try { const s = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); return s && s.toJSON(); } catch { return null; } }
function syncNote() {
  const sy = S && S.sync;
  if (!S || !sy || !API) return '';
  if (sy.status === 'gone') return 'El organizador ha finalizado el rally.';
  if (sy.status === 'local') return '⚠️ Sin conexión con el servidor de avisos: este rally funciona solo en este dispositivo y los avisos solo llegan con la app abierta (alarma local).';
  if (sy.status === 'offline') return sy.role === 'host' ? '⚠️ Sin conexión: la pausa o reanudación se enviará al recuperar internet. Mientras, los avisos con pantalla bloqueada pueden llegar a destiempo.' : '⚠️ Sin conexión: no se puede comprobar si el organizador ha pausado el rally.';
  if (sy.status === 'pending') return 'Conectando con el servidor de avisos…';
  if (sy.full) return 'Este rally ya tiene el máximo de 10 dispositivos con avisos: aquí solo sonará con la app abierta.';
  return '';
}
const pushActive = () => !!(S && S.sync && S.sync.code && S.sync.subOk && pushOn() && ['ok', 'offline'].includes(S.sync.status) && !S.finished);

// ===== UI =====
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
function fmt(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
const segVal = n => $(`.seg[data-name=${n}] .on`).dataset.v;
function freqHint() {
  const f = segVal('freq');
  const [lo, hi] = freqRange(f);
  $('#freqHint').textContent = `${lo}–${hi} eventos en todo el rally, repartidos al azar`;
  const L = { baja: 'Baja', media: 'Media', alta: 'Alta' };
  $('#freqHelp').textContent = LEVELS.map(k => `${L[k]}: ${FREQ[k][0]}–${FREQ[k][1]} eventos en todo el rally`).join(' · ')
    + ` · Aleatoria: ${freqRange('aleatoria').join('–')} eventos (del mínimo de Baja al máximo de Alta).`;
}
// ===== Ajustes =====
function fillSettings(f) { LEVELS.forEach(k => { $(`#set-${k}-min`).value = f[k][0]; $(`#set-${k}-max`).value = f[k][1]; }); $('#setErr').textContent = ''; }
function readSettings() {
  const f = {}, errs = [];
  for (const k of LEVELS) {
    const v = ['min', 'max'].map(m => { const s = $(`#set-${k}-${m}`).value.trim(); return /^\d+$/.test(s) ? +s : NaN; });
    const name = k[0].toUpperCase() + k.slice(1);
    if (v.some(n => !Number.isInteger(n) || n > 99)) errs.push(`${name}: usa números enteros entre 0 y 99`);
    else if (v[0] > v[1]) errs.push(`${name}: el mínimo no puede ser mayor que el máximo`);
    f[k] = v;
  }
  if (!errs.length) {
    if (!(f.baja[0] <= f.media[0] && f.media[0] <= f.alta[0])) errs.push('Los mínimos deben cumplir Baja ≤ Media ≤ Alta');
    if (!(f.baja[1] <= f.media[1] && f.media[1] <= f.alta[1])) errs.push('Los máximos deben cumplir Baja ≤ Media ≤ Alta');
  }
  return { f, errs };
}
function openSettings() {
  fillSettings(FREQ); $('#settings').showModal();
  history.pushState({ ajustes: true }, ''); // el botón «Atrás» del navegador/móvil cierra Ajustes
}
function closeSettings() { if (history.state && history.state.ajustes) history.back(); else if ($('#settings').open) $('#settings').close(); }
function saveSettings() {
  const { f, errs } = readSettings();
  if (errs.length) { $('#setErr').textContent = errs.join('. ') + '.'; return; }
  FREQ = f; localStorage.setItem(FREQ_STORE, JSON.stringify(f)); freqHint(); closeSettings();
}
// ===== Estado de las notificaciones =====
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function notifStatus() {
  if (isIOS() && !isStandalone()) return { k: 'ios', t: 'En iPhone las notificaciones solo funcionan con la app instalada: pulsa Compartir → «Añadir a pantalla de inicio» y ábrela desde el icono.' };
  if (!('Notification' in window) || !navigator.serviceWorker) return { k: 'unsupported', t: 'Este navegador no admite notificaciones: los eventos solo se verán y sonarán con la app abierta.' };
  if (Notification.permission === 'denied') return { k: 'denied', t: 'Notificaciones bloqueadas: actívalas en los ajustes del navegador o del teléfono para recibir avisos.' };
  if (Notification.permission === 'default') return { k: 'default', t: 'Notificaciones sin activar: pulsa «Activar notificaciones».' };
  return { k: 'granted', t: '' };
}
function renderNotif() {
  const st = notifStatus();
  for (const id of ['#notifStatus', '#notifStatusRace']) { const el = $(id); el.textContent = st.t; el.dataset.k = st.k; el.classList.toggle('hidden', !st.t); }
}
// ===== Atrás / cerrar en la pantalla de carrera =====
function ensureRaceState() { if (S && !(history.state && (history.state.race || history.state.ajustes || history.state.ayuda))) history.pushState({ race: true }, ''); }
function endRace() {
  finishRemote(S && S.sync);
  S = null; save(); if (wakeLock) setWake(false); $('#wakeToggle').checked = false;
  if (history.state && history.state.race) history.back();
  render();
}
const isGuest = () => !!(S && S.sync && S.sync.role === 'guest');
const endQ = () => isGuest() ? '¿Salir del rally? (seguirá en los demás dispositivos)' : '¿Finalizar el rally?';
const askEnd = () => { if (S && S.finished && isGuest()) { endRace(); return true; } if (confirm(endQ())) { endRace(); return true; } return false; };
function show(scr) { document.body.dataset.screen = scr; $('#setup').classList.toggle('hidden', scr !== 'setup'); $('#race').classList.toggle('hidden', scr !== 'race'); }
// Solo escribe en el DOM si cambia (evita que la región viva se anuncie cada segundo).
function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
function setHTML(el, h) { if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; } }
function render() {
  renderNotif();
  const running = !!S;
  $('#setBtn').disabled = running; $('#setLock').classList.toggle('hidden', !running);
  if (!S) return show('setup');
  show('race');
  const el = Math.min(raceElapsed(), S.durationMs);
  $('#remaining').textContent = fmt(S.durationMs - el);
  $('#elapsed').textContent = fmt(el);
  $('#pausedTag').classList.toggle('hidden', !S.pausedAt || S.finished);
  $('#pauseBtn').textContent = S.pausedAt ? 'Reanudar' : 'Pausa';
  $('#pauseBtn').disabled = S.finished;
  const sy = S.sync || {}, guest = sy.role === 'guest';
  $('#codeBox').classList.toggle('hidden', !sy.code);
  $('#codeVal').textContent = fmtCode(sy.code);
  $('#codeHost').classList.toggle('hidden', guest); $('#codeGuest').classList.toggle('hidden', !guest);
  $('#shareBtn').classList.toggle('hidden', guest || S.finished);
  $('#endBtn').textContent = guest ? 'Salir del rally' : 'Finalizar rally';
  $('#raceClose').setAttribute('aria-label', guest ? 'Salir del rally' : 'Cerrar rally');
  const sn = syncNote(); setText($('#syncNote'), sn); $('#syncNote').classList.toggle('hidden', !sn);
  const pa = pushActive(); $('#bgWarn').classList.toggle('hidden', pa); $('#pushOk').classList.toggle('hidden', !pa);
  const last = S.events.at(-1);
  setHTML($('#current .cicon'), ic(S.finished ? 'finish' : last ? last.icon : 'road'));
  setText($('#current .ctext'), S.finished ? 'Rally terminado' : last ? last.text : 'Tramos despejados');
  setText($('#current .ctime'), last && !S.finished ? 'a las ' + fmt(last.at) + ' de rally' : '');
  $('#newBtn').classList.toggle('hidden', !S.finished);
  $('#pauseBtn').classList.toggle('hidden', !!S.finished || guest); // invitados: solo ver
  $('#zeroNote').classList.toggle('hidden', !(S.schedule && S.schedule.length === 0));
  const n = S.cfg.tramos || 3, tg = $('#tramos');
  tg.style.gridTemplateColumns = `repeat(${n},1fr)`;
  setHTML(tg, Array.from({ length: n }, (_, i) => {
    const e = S.events.filter(x => x.tramo === i + 1).at(-1);
    return `<div class="tramo${e && e === last ? ' new' : ''}" data-tramo="${i + 1}"><b>T${i + 1}</b><span class="ti">${ic(e ? e.icon : 'road')}</span><small>${e ? esc(e.label) : 'Despejado'}</small>${e ? `<time>${fmt(e.at)}</time>` : ''}</div>`;
  }).join(''));
  const h = $('#history');
  if (h.childElementCount !== S.events.length) {
    h.innerHTML = '';
    S.events.slice().reverse().forEach(e => {
      const li = document.createElement('li');
      li.innerHTML = `<time>${fmt(e.at)}</time><span class="hi">${ic(e.icon)}</span><span>${esc(e.text)}</span>`;
      h.appendChild(li);
    });
  }
  $('#notifBtn').classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'default' || (isIOS() && !isStandalone()));
}
function tick() { alertEvents(catchUp()); render(); }

let outside = () => false;
function init() {
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', b === e.target); }); freqHint();
  }));
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on')));
  freqHint();
  $('#startBtn').onclick = () => {
    const raw = s => $(s).value.trim(), ok = s => s === '' || /^\d+$/.test(s);
    const hs = raw('#hours'), ms_ = raw('#minutes');
    if (!ok(hs) || !ok(ms_)) return alert('Usa horas y minutos enteros (sin decimales)');
    const h = +hs || 0, m = +ms_ || 0;
    if (m > 59) return alert('Los minutos deben estar entre 0 y 59');
    const ms = (h * 60 + m) * MIN;
    if (ms <= 0) return alert('Indica una duración');
    if (ms > MAX_MS) return alert('La duración máxima es 48 h 00 min');
    alarm(); // desbloquea el audio con un gesto del usuario
    const perm = 'Notification' in window && Notification.permission === 'default' ? Notification.requestPermission().catch(() => {}) : Promise.resolve();
    startRace({ durationMs: ms, type: segVal('type'), freq: segVal('freq'), intensity: segVal('intensity'), tramos: +segVal('tramos') });
    if (!API) S.sync = null;
    ensureRaceState(); render();
    Promise.resolve(perm).then(() => { render(); hostCreate(); });
  };
  $('#pauseBtn').onclick = () => { if (isGuest()) return; S.pausedAt ? (resume(), queue('resume')) : (pause(), queue('pause')); render(); };
  $('#endBtn').onclick = $('#raceClose').onclick = askEnd;
  $('#newBtn').onclick = endRace; // rally terminado: volver a la configuración sin preguntar
  $('#wakeToggle').onchange = e => setWake(e.target.checked);
  $('#notifBtn').onclick = () => Notification.requestPermission().then(() => { render(); resubscribe(); });
  // ---- rally compartido ----
  for (const id of ['#pushToggle', '#pushToggleRace']) { $(id).checked = pushOn(); $(id).onchange = e => setPush(e.target.checked); }
  $('#joinBtn').classList.toggle('hidden', !API); $('#pushRow').classList.toggle('hidden', !API); $('#pushRowRace').classList.toggle('hidden', !API); $('#pushHint').classList.toggle('hidden', !API);
  const closeJoin = () => { if (history.state && history.state.unirse) history.back(); else if ($('#join').open) $('#join').close(); };
  $('#joinBtn').onclick = () => { if (S) return; $('#joinErr').textContent = ''; $('#joinCode').value = ''; $('#join').showModal(); history.pushState({ unirse: true }, ''); };
  $('#joinClose').onclick = $('#joinCancel').onclick = closeJoin;
  $('#join').addEventListener('cancel', e => { e.preventDefault(); closeJoin(); });
  $('#join').addEventListener('click', e => { if (outside(e)) closeJoin(); });
  $('#joinCode').addEventListener('input', e => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); e.target.value = v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3) : v; });
  $('#joinForm').onsubmit = async e => {
    e.preventDefault(); alarm(); // gesto del usuario: activa el audio de la alarma fuerte
    const b = $('#joinGo'); b.disabled = true; $('#joinErr').textContent = 'Conectando…';
    const err = await joinRally($('#joinCode').value); b.disabled = false;
    $('#joinErr').textContent = err; if (err) return;
    $('#join').close(); if (history.state && history.state.unirse) history.replaceState({ race: true }, '');
    ensureRaceState(); render();
  };
  $('#shareBtn').onclick = async () => {
    const c = fmtCode(S && S.sync && S.sync.code), t = `Código del rally de Eventos: ${c}`;
    try { if (navigator.share) return await navigator.share({ text: t }); await navigator.clipboard.writeText(c); $('#shareBtn').textContent = 'Copiado'; setTimeout(() => $('#shareBtn').textContent = 'Compartir código', 1500); } catch {}
  };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'push') tick(); }); // aviso push con la app abierta
  window.addEventListener('online', () => { flush(); retryFinish(); hostCreate(); pollGuest(); });
  $('#helpClose').onclick = () => $('#help').close();
  $('#helpBtn').onclick = () => { $('#help').showModal(); history.pushState({ ayuda: true }, ''); };
  $('#help').addEventListener('close', () => { if (history.state && history.state.ayuda) history.back(); });
  // clic en el fondo oscuro cierra los diálogos
  outside = e => { const r = e.currentTarget.getBoundingClientRect(); return e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); };
  $('#help').addEventListener('click', e => { if (outside(e)) $('#help').close(); });
  $('#settings').addEventListener('click', e => { if (outside(e)) closeSettings(); });
    // Enteros fuera de rango se ajustan al salir del campo; los decimales no se redondean (se avisa al empezar).
  const clamp = (el, max) => el.addEventListener('change', () => { const t = el.value.trim(); if (/^-?\d+$/.test(t)) el.value = Math.min(max, Math.max(0, +t)); });
  clamp($('#hours'), 48); clamp($('#minutes'), 59);
  $('#setBtn').onclick = () => { if (!S) openSettings(); };
  $('#setClose').onclick = $('#setBack').onclick = $('#setCancel').onclick = closeSettings;
  $('#setSave').onclick = saveSettings;
  $('#setReset').onclick = () => fillSettings(FREQ_DEFAULT);
  $('#settings').addEventListener('cancel', e => { e.preventDefault(); closeSettings(); }); // tecla Esc
  window.addEventListener('popstate', () => {
    let wasOpen = false;
    for (const d of ['#settings', '#help', '#join']) if ($(d).open) { $(d).close(); wasOpen = true; }
    if (wasOpen || !S) return; // Atrás cerró un diálogo, o no hay rally
    if (history.state && history.state.race) return;
    // Atrás en la pantalla de carrera: preguntar si se finaliza
    if (S.finished && isGuest()) { finishRemote(S.sync); S = null; save(); render(); }
    else if (confirm(endQ())) { finishRemote(S.sync); S = null; save(); if (wakeLock) setWake(false); $('#wakeToggle').checked = false; render(); }
    else history.pushState({ race: true }, '');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); resubscribe(); pollGuest(); flush(); if ($('#wakeToggle').checked && S && !S.finished) setWake(true); }
  });
  S = load();
  // Tras recargar con un diálogo abierto, history.state puede ser «ajustes»/«ayuda» sin diálogo: normalizar.
  if (history.state && (history.state.ajustes || history.state.ayuda || history.state.unirse)) history.back(); // vuelve a la entrada anterior (rally o inicio) sin preguntar
  ensureRaceState();
  tick();
  setInterval(tick, 1000);
  // sincronización: invitados consultan el estado cada 10 s; el creador reintenta lo pendiente cada 15 s
  setInterval(() => { if (document.visibilityState === 'visible') pollGuest(); }, +(localStorage.getItem('eventos.poll') || 10000));
  setInterval(() => { flush(); retryFinish(); if (S && S.sync && S.sync.status === 'local' && !S.sync.code && navigator.onLine) hostCreate(); }, 15000);
  if (S && S.sync && S.sync.status === 'pending') hostCreate();
  resubscribe(); pollGuest(); flush(); retryFinish();
  if ('serviceWorker' in navigator) {
    // Al activarse un SW nuevo (skipWaiting + clients.claim) recargamos una vez para usar los archivos nuevos.
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    // No recargar con un diálogo abierto (se perderían cambios sin guardar): esperar a que se cierre.
    const reloadSoon = () => { if (reloaded) return; if ($('#settings').open || $('#help').open || $('#join').open) return setTimeout(reloadSoon, 1000); reloaded = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadSoon(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
}
window.Eventos = { get FREQ() { return FREQ; }, FREQ_DEFAULT, validFreq, esc, notifStatus, freqRange, schedule, makeEvent, get state() { return S; }, raceElapsed, catchUp, pause, resume, get API() { return API; }, fmtCode, pushActive };
init();

// ---------- sin zoom (pellizco y doble toque) ----------
// iOS ignora user-scalable=no desde iOS 10: se bloquean también los gestos y el doble toque. Un toque rápido repetido sobre
// un botón (p. ej. teclado) se convierte en su clic, así que ningún toque se pierde. Campos de texto: comportamiento nativo.
(function(){const pd=e=>e.preventDefault();
  for(const t of ['gesturestart','gesturechange','gestureend'])document.addEventListener(t,pd,{passive:false});
  let sx=0,sy=0,moved=false,last=0,lx=0,ly=0;
  document.addEventListener('touchstart',e=>{const t=e.touches[0];sx=t.clientX;sy=t.clientY;moved=e.touches.length>1;},{passive:true});
  document.addEventListener('touchmove',e=>{if(e.touches.length>1){e.preventDefault();moved=true;return;}const t=e.touches[0];if(t&&Math.hypot(t.clientX-sx,t.clientY-sy)>10)moved=true;},{passive:false});
  document.addEventListener('touchend',e=>{if(e.touches.length)return;const t=e.changedTouches[0];if(!t)return;const now=Date.now();
    const dbl=!moved&&now-last<350&&Math.hypot(t.clientX-lx,t.clientY-ly)<40;last=moved?0:now;lx=t.clientX;ly=t.clientY;if(!dbl)return;
    const el=e.target&&e.target.closest?e.target:e.target&&e.target.parentElement;if(!el||el.closest('input,select,textarea,[contenteditable]'))return;
    e.preventDefault();const c=el.closest('button,a[href],label,summary,[role=button],[data-act],[data-key],[data-eact],[data-f]');if(c&&!c.disabled)c.click();},{passive:false});
})();
