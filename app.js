'use strict';
// ===== Configuración =====
const MIN = 60000;
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
  return !!s && typeof s === 'object' && s.cfg && typeof s.cfg === 'object' && [s.startTs, s.durationMs, s.pausedTotal].every(Number.isFinite)
    && Array.isArray(s.events) && (s.schedule == null || (Array.isArray(s.schedule) && s.schedule.every(Number.isFinite)));
}
const load = () => { try { const s = JSON.parse(localStorage.getItem(STORE)); return validState(s) ? s : null; } catch { return null; } };
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
    const ev = { ...makeEvent(S.cfg), at, wall: S.startTs + S.pausedTotal + at }; // 'at' = tiempo de carrera; 'wall' ≈ hora real (descontando pausas)
    S.events.push(ev); fired.push(ev);
  }
  if (el >= S.durationMs) { S.finished = true; if (wakeLock) setWake(false); }
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
    await reg.showNotification((ev.kind === 'pinchazos' ? '🛞 ' : ev.kind === 'clima' ? '❄ ' : '⚠ ') + ev.text, { body: 'Tiempo de rally ' + fmt(ev.at), icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png', tag: 'eventos-' + (S ? S.startTs : 0) + '-' + ev.at + '-' + (ev.n || 1), renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 800] });
  } catch (e) { /* ignore */ }
}
function alertEvents(evs) {
  if (!evs.length) return;
  alarm();
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
  notify(evs.length > 1 ? { text: evs.length + ' eventos: ' + evs.map(e => e.text).join(', '), at: evs.at(-1).at, n: evs.length } : evs[0]);
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
  S = null; save(); if (wakeLock) setWake(false); $('#wakeToggle').checked = false;
  if (history.state && history.state.race) history.back();
  render();
}
const askEnd = () => { if (confirm('¿Finalizar el rally?')) { endRace(); return true; } return false; };
function show(scr) { document.body.dataset.screen = scr; $('#setup').classList.toggle('hidden', scr !== 'setup'); $('#race').classList.toggle('hidden', scr !== 'race'); }
function render() {
  renderNotif();
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
  $('#current .ctime').textContent = last && !S.finished ? 'a las ' + fmt(last.at) + ' de rally' : '';
  $('#zeroNote').classList.toggle('hidden', !(S.schedule && S.schedule.length === 0));
  const n = S.cfg.tramos || 3, tg = $('#tramos');
  tg.style.gridTemplateColumns = `repeat(${n},1fr)`;
  tg.innerHTML = Array.from({ length: n }, (_, i) => {
    const e = S.events.filter(x => x.tramo === i + 1).at(-1);
    return `<div class="tramo${e && e === last ? ' new' : ''}" data-tramo="${i + 1}"><b>T${i + 1}</b><span class="ti">${ic(e ? e.icon : 'road')}</span><small>${e ? esc(e.label) : 'Despejado'}</small>${e ? `<time>${fmt(e.at)}</time>` : ''}</div>`;
  }).join('');
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

function init() {
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', b === e.target); }); freqHint();
  }));
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on')));
  freqHint();
  $('#startBtn').onclick = () => {
    const num = (s, max) => Math.min(max, Math.max(0, Math.round(+$(s).value) || 0));
    const ms = (num('#hours', 48) * 60 + num('#minutes', 59)) * MIN;
    if (ms <= 0) return alert('Indica una duración');
    alarm(); // desbloquea el audio con un gesto del usuario
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(render);
    startRace({ durationMs: ms, type: segVal('type'), freq: segVal('freq'), intensity: segVal('intensity'), tramos: +segVal('tramos') });
    ensureRaceState(); render();
  };
  $('#pauseBtn').onclick = () => { S.pausedAt ? resume() : pause(); render(); };
  $('#endBtn').onclick = $('#raceClose').onclick = askEnd;
  $('#wakeToggle').onchange = e => setWake(e.target.checked);
  $('#notifBtn').onclick = () => Notification.requestPermission().then(render);
  $('#helpClose').onclick = () => $('#help').close();
  $('#helpBtn').onclick = () => { $('#help').showModal(); history.pushState({ ayuda: true }, ''); };
  $('#help').addEventListener('close', () => { if (history.state && history.state.ayuda) history.back(); });
  // clic en el fondo oscuro cierra los diálogos
  const outside = e => { const r = e.currentTarget.getBoundingClientRect(); return e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); };
  $('#help').addEventListener('click', e => { if (outside(e)) $('#help').close(); });
  $('#settings').addEventListener('click', e => { if (outside(e)) closeSettings(); });
  const clamp = (el, max) => el.addEventListener('change', () => { const v = Math.round(+el.value); el.value = Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0; });
  clamp($('#hours'), 48); clamp($('#minutes'), 59);
  $('#setBtn').onclick = openSettings;
  $('#setClose').onclick = $('#setBack').onclick = $('#setCancel').onclick = closeSettings;
  $('#setSave').onclick = saveSettings;
  $('#setReset').onclick = () => fillSettings(FREQ_DEFAULT);
  $('#settings').addEventListener('cancel', e => { e.preventDefault(); closeSettings(); }); // tecla Esc
  window.addEventListener('popstate', () => {
    let wasOpen = false;
    for (const d of ['#settings', '#help']) if ($(d).open) { $(d).close(); wasOpen = true; }
    if (wasOpen || !S) return; // Atrás cerró un diálogo, o no hay rally
    if (history.state && history.state.race) return;
    // Atrás en la pantalla de carrera: preguntar si se finaliza
    if (confirm('¿Finalizar el rally?')) { S = null; save(); if (wakeLock) setWake(false); $('#wakeToggle').checked = false; render(); }
    else history.pushState({ race: true }, '');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); if ($('#wakeToggle').checked) setWake(true); }
  });
  S = load();
  ensureRaceState();
  tick();
  setInterval(tick, 1000);
  if ('serviceWorker' in navigator) {
    // Al activarse un SW nuevo (skipWaiting + clients.claim) recargamos una vez para usar los archivos nuevos.
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    // No recargar con un diálogo abierto (se perderían cambios sin guardar): esperar a que se cierre.
    const reloadSoon = () => { if (reloaded) return; if ($('#settings').open || $('#help').open) return setTimeout(reloadSoon, 1000); reloaded = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadSoon(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
}
window.Eventos = { get FREQ() { return FREQ; }, FREQ_DEFAULT, validFreq, esc, notifStatus, freqRange, schedule, makeEvent, get state() { return S; }, raceElapsed, catchUp, pause, resume };
init();
