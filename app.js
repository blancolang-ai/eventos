'use strict';
// ===== Configuración =====
const MIN = 60000;
// Frecuencia = nº TOTAL de eventos en todo el rally, elegido al azar al empezar (ambos extremos incluidos).
// Los rangos se pueden cambiar en Ajustes (localStorage); «aleatoria» va del mínimo de Baja al máximo de Alta.
const FREQ_DEFAULT = { baja: [0, 2], media: [1, 3], alta: [2, 4] };
const FREQ_STORE = 'eventos.freq.v1';
const LEVELS = ['baja', 'media', 'alta'];
function validFreq(f) {
  return !!f && LEVELS.every(k => Array.isArray(f[k]) && f[k].length === 2 && f[k].every(n => Number.isInteger(n) && n >= 0 && n <= 99) && f[k][0] <= f[k][1]);
}
let FREQ = (() => { try { const f = JSON.parse(localStorage.getItem(FREQ_STORE)); if (validFreq(f)) return f; } catch {} return structuredClone(FREQ_DEFAULT); })();
const freqRange = f => f === 'aleatoria' ? [FREQ.baja[0], FREQ.alta[1]] : (FREQ[f] || FREQ.media);
const STORE = 'eventos.race.v1';
const SNOW = { suave: 'Nevada suave', moderada: 'Nevada moderada', intensa: 'Nevada intensa' }; // nieve = harina en pista
const SLOW_P = { suave: 0.8, moderada: 0.55, intensa: 0.25, aleatoria: 0.5 }; // prob. de «Pinchazo lento» frente a «Reventón»
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];
// Calendario de eventos: N al azar según la frecuencia; la duración se divide en N+1 segmentos
// y cada evento cae con jitter (±40 % de segmento) alrededor de su marca, sin tocar ni el inicio ni el final.
function schedule(freq, durationMs, r = Math.random) {
  const [lo, hi] = freqRange(freq);
  const n = lo + Math.floor(r() * (hi - lo + 1)), seg = durationMs / (n + 1);
  return Array.from({ length: n }, (_, i) => Math.round(seg * (i + 1 + (r() - 0.5) * 0.8)));
}
// Los eventos no tienen duración: solo se anuncian.
function makeEvent(cfg, r = Math.random) {
  const tramo = 1 + Math.floor(r() * (cfg.tramos || 3));
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
const ic = k => ICONS[k] || k;

// ===== Estado (basado en marcas de tiempo) =====
let S = null;
const save = () => S ? localStorage.setItem(STORE, JSON.stringify(S)) : localStorage.removeItem(STORE);
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } };
function raceElapsed(now = Date.now()) {
  if (!S) return 0;
  return now - S.startTs - S.pausedTotal - (S.pausedAt ? now - S.pausedAt : 0);
}
function startRace(cfg, now = Date.now()) {
  S = { cfg, startTs: now, durationMs: cfg.durationMs, pausedTotal: 0, pausedAt: null, events: [],
        schedule: schedule(cfg.freq, cfg.durationMs), finished: false };
  save();
}
function pause(now = Date.now()) { if (S && !S.pausedAt) { S.pausedAt = now; save(); } }
function resume(now = Date.now()) { if (S && S.pausedAt) { S.pausedTotal += now - S.pausedAt; S.pausedAt = null; save(); } }
// Dispara todos los eventos vencidos (incluye los ocurridos con la app oculta).
function catchUp(now = Date.now()) {
  if (!S || S.finished) return [];
  const el = raceElapsed(now), fired = [];
  if (!S.schedule) S.schedule = schedule(S.cfg.freq, S.durationMs); // rally guardado por una versión anterior
  while (S.events.length < S.schedule.length && S.schedule[S.events.length] <= el) {
    const at = S.schedule[S.events.length];
    const ev = { ...makeEvent(S.cfg), at, wall: S.startTs + at }; // 'at' = tiempo de carrera
    S.events.push(ev); fired.push(ev);
  }
  if (el >= S.durationMs) S.finished = true;
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
async function notify(ev) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('❄ ' + ev.text, { body: 'Tiempo de rally ' + fmt(ev.at), icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png', tag: 'eventos-rally', renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 800] });
  } catch (e) { /* ignore */ }
}
function alertEvents(evs) {
  if (!evs.length) return;
  alarm();
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
  notify(evs.length > 1 ? { text: evs.length + ' eventos: ' + evs.map(e => e.text).join(', '), at: evs.at(-1).at } : evs[0]);
  const c = $('#current'); c.classList.remove('alert'); void c.offsetWidth; c.classList.add('alert');
}
async function setWake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { $('#wakeToggle').checked = false; }
}

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
function show(scr) { document.body.dataset.screen = scr; $('#setup').classList.toggle('hidden', scr !== 'setup'); $('#race').classList.toggle('hidden', scr !== 'race'); }
function render() {
  if (!S) return show('setup');
  show('race');
  const el = Math.min(raceElapsed(), S.durationMs);
  $('#remaining').textContent = fmt(S.durationMs - el);
  $('#elapsed').textContent = fmt(el);
  $('#pausedTag').classList.toggle('hidden', !S.pausedAt || S.finished);
  $('#pauseBtn').textContent = S.pausedAt ? 'Reanudar' : 'Pausa';
  $('#pauseBtn').disabled = S.finished;
  const last = S.events.at(-1);
  $('#current .cicon').innerHTML = ic(S.finished ? 'finish' : last ? last.icon : 'road');
  $('#current .ctext').textContent = S.finished ? 'Rally terminado' : last ? last.text : 'Tramos despejados';
  $('#current .ctime').textContent = last && !S.finished ? 'en el minuto ' + fmt(last.at) : '';
  const n = S.cfg.tramos || 3, tg = $('#tramos');
  tg.style.gridTemplateColumns = `repeat(${n},1fr)`;
  tg.innerHTML = Array.from({ length: n }, (_, i) => {
    const e = S.events.filter(x => x.tramo === i + 1).at(-1);
    return `<div class="tramo${e && e === last ? ' new' : ''}" data-tramo="${i + 1}"><b>T${i + 1}</b><span class="ti">${ic(e ? e.icon : 'road')}</span><small>${e ? e.label : 'Despejado'}</small>${e ? `<time>${fmt(e.at)}</time>` : ''}</div>`;
  }).join('');
  const h = $('#history');
  if (h.childElementCount !== S.events.length) {
    h.innerHTML = '';
    S.events.slice().reverse().forEach(e => {
      const li = document.createElement('li');
      li.innerHTML = `<time>${fmt(e.at)}</time><span class="hi">${ic(e.icon)}</span><span>${e.text}</span>`;
      h.appendChild(li);
    });
  }
  $('#notifBtn').classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'default');
}
function tick() { alertEvents(catchUp()); render(); }

function init() {
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); freqHint();
  }));
  freqHint();
  $('#startBtn').onclick = () => {
    const ms = ((+$('#hours').value || 0) * 60 + (+$('#minutes').value || 0)) * MIN;
    if (ms <= 0) return alert('Indica una duración');
    alarm(); // desbloquea el audio con un gesto del usuario
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(render);
    startRace({ durationMs: ms, type: segVal('type'), freq: segVal('freq'), intensity: segVal('intensity'), tramos: +segVal('tramos') });
    render();
  };
  $('#pauseBtn').onclick = () => { S.pausedAt ? resume() : pause(); render(); };
  $('#endBtn').onclick = () => { if (confirm('¿Finalizar el rally?')) { S = null; save(); render(); } };
  $('#wakeToggle').onchange = e => setWake(e.target.checked);
  $('#notifBtn').onclick = () => Notification.requestPermission().then(render);
  $('#helpBtn').onclick = () => $('#help').showModal();
  $('#setBtn').onclick = openSettings;
  $('#setClose').onclick = $('#setBack').onclick = $('#setCancel').onclick = closeSettings;
  $('#setSave').onclick = saveSettings;
  $('#setReset').onclick = () => fillSettings(FREQ_DEFAULT);
  $('#settings').addEventListener('cancel', e => { e.preventDefault(); closeSettings(); }); // tecla Esc
  window.addEventListener('popstate', () => { if ($('#settings').open) $('#settings').close(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); if ($('#wakeToggle').checked) setWake(true); }
  });
  S = load();
  tick();
  setInterval(tick, 1000);
  if ('serviceWorker' in navigator) {
    // Al activarse un SW nuevo (skipWaiting + clients.claim) recargamos una vez para usar los archivos nuevos.
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
}
window.Eventos = { get FREQ() { return FREQ; }, FREQ_DEFAULT, freqRange, schedule, makeEvent, get state() { return S; }, raceElapsed, catchUp, pause, resume };
init();
