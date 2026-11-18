// SCHALTZENTRALE – Fachwissen Elektro/Automatisierung mit Wiederholungssystem (Lern-Motor aus KOPFSACHE)
'use strict';
const SPEICHER = 'schaltzentrale-v1';
const APP = 'SCHALTZENTRALE';
const STUFEN = ['Geselle', 'Praxis', 'Werkmeister', 'Ingenieur'];
const TAG = 86400000;
const ZIEL_SEK = 300; // Mindestziel 5 Minuten für den Streak
const AWL_LINK = 'https://claude.ai/artifact/KwdPGdLVHhBmiiKDrjDiYR';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const heute = (d = new Date()) => { const z = new Date(d); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`; };
const tageZwischen = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / TAG);
const mischen = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const katName = id => (KATEGORIEN.find(k => k.id === id) || { name: id }).name;
const katIcon = id => (KATEGORIEN.find(k => k.id === id) || { icon: '❓' }).icon;

// ───────── Zustand ─────────
function leererZustand() {
  return {
    version: 1, erstellt: Date.now(),
    setup: { fertig: false, interessen: {}, ziel: 'mix', tageszeit: 'abend', minuten: 10 },
    einstufung: { fertig: false, start: {} },
    karten: {}, tage: {}, xp: 0, stufe: {}, anlagen: [],
    streak: { n: 0, best: 0, last: null, schutz: 1, geschuetzt: [] },
    neuProTag: 10, meldungen: [], eigene: [],
  };
}
let Z;
try { Z = Object.assign(leererZustand(), JSON.parse(localStorage.getItem(SPEICHER) || 'null') || {}); } catch (e) { Z = leererZustand(); }
const speichern = () => { try { localStorage.setItem(SPEICHER, JSON.stringify(Z)); } catch (e) { toast('Speichern fehlgeschlagen'); } };

const alleFragen = () => FRAGEN.concat(Z.eigene || []);
const frageVon = id => alleFragen().find(q => q.id === id);
const tagHeute = () => (Z.tage[heute()] ||= { sek: 0, fragen: 0, richtig: 0, neu: 0, ziel: false, xp: 0 });
const abgelaufen = q => q.ab && q.ab < heute();

// ───────── Streak mit Schutztagen (zählt nur Montag–Freitag) ─────────
const werktag = d => { const w = new Date(d + 'T12:00').getDay(); return w >= 1 && w <= 5; };
// Werktage echt zwischen a und b (ohne a und b)
function werktageZwischen(a, b) {
  const liste = [];
  for (let t = new Date(a + 'T12:00').getTime() + TAG; heute(new Date(t)) < b; t += TAG) { const d = heute(new Date(t)); if (werktag(d)) liste.push(d); }
  return liste;
}
function streakPruefen() {
  const s = Z.streak, h = heute();
  if (!s.last || s.last >= h) return;
  const fehl = werktageZwischen(s.last, h);
  if (!fehl.length) return;
  if (s.n > 0 && s.schutz >= fehl.length) {
    s.schutz -= fehl.length;
    s.geschuetzt.push(...fehl);
    s.last = fehl[fehl.length - 1];
    toast(`🛡️ ${fehl.length} Schutztag${fehl.length > 1 ? 'e' : ''} eingesetzt – dein Streak bleibt`);
  } else {
    s.n = 0;
  }
  speichern();
}
function zielErreicht() {
  const t = tagHeute();
  if (t.ziel) return;
  t.ziel = true; t.xp += 50; Z.xp += 50;
  const s = Z.streak, h = heute();
  if (werktag(h) && s.last !== h) {
    s.n = (s.last && s.n > 0 && !werktageZwischen(s.last, h).length) ? s.n + 1 : 1;
    s.last = h;
    s.best = Math.max(s.best, s.n);
    if (s.n % 5 === 0 && s.schutz < 2) { s.schutz++; toast('🛡️ Neuer Schutztag verdient!'); }
  }
  speichern();
}

// ───────── Stufen (Geselle · Praxis · Werkmeister · Ingenieur) ─────────
const aktStufe = k => Z.stufe[k] || Z.einstufung.start[k] || 1;
const beherrscht = q => (Z.karten[q.id]?.stufe || 0) >= 2;
function stufeFreischalten(k) {
  const st = aktStufe(k);
  if (st >= 4) return;
  const qs = FRAGEN.filter(q => q.k === k && q.n === st);
  if (qs.length && qs.filter(beherrscht).length / qs.length >= 0.8) {
    Z.stufe[k] = st + 1; speichern();
    toast(`🔓 ${katName(k)}: Stufe ${STUFEN[st]} freigeschaltet`);
  }
}

// ───────── Level ─────────
const level = xp => Math.floor(Math.sqrt(xp / 40)) + 1;
const xpFuer = l => 40 * (l - 1) * (l - 1);

// ───────── Vorschlag für heute (lernt aus deinem Verhalten) ─────────
function vorschlagMinuten() {
  const tage = Object.entries(Z.tage).filter(([d, t]) => t.sek > 60 && d !== heute()).sort().slice(-7);
  if (tage.length < 3) return Z.setup.minuten || 10;
  const schnitt = tage.reduce((s, [, t]) => s + t.sek, 0) / tage.length / 60;
  return Math.max(5, Math.min(20, Math.round(schnitt)));
}

// ───────── Karten-Auswahl ─────────
const gewicht = kat => [0.2, 1, 2][Z.setup.interessen[kat] ?? 1];
function faellige(kat) {
  const jetzt = Date.now();
  return alleFragen().filter(q => (!kat || q.k === kat) && Z.karten[q.id]?.last && Z.karten[q.id].due <= jetzt)
    .sort((a, b) => FSRS.abrufJetzt(Z.karten[a.id]) - FSRS.abrufJetzt(Z.karten[b.id]));
}
function neueFragen(kat) {
  return alleFragen().filter(q => (!kat || q.k === kat) && !Z.karten[q.id]?.last);
}
function naechsteNeue(kat, ausgeschlossen) {
  const pool = neueFragen(kat).filter(q => !ausgeschlossen.has(q.id) && (q.eigen || q.n <= aktStufe(q.k)));
  if (!pool.length) return null;
  // Kategorie gewichtet nach Interesse wählen (Interleaving)
  const kats = [...new Set(pool.map(q => q.k))];
  let summe = kats.reduce((s, k) => s + gewicht(k), 0), r = Math.random() * summe, gew = kats[0];
  for (const k of kats) { r -= gewicht(k); if (r <= 0) { gew = k; break; } }
  const kandidaten = pool.filter(q => q.k === gew);
  // zuerst Fragen deiner aktuellen Stufe, danach die darunter
  kandidaten.sort((a, b) => (b.n - a.n) || (Math.random() - 0.5));
  return kandidaten[0];
}

// ───────── Fragetyp nach Lernstand (gestaffelt) ─────────
function formatFuer(q) {
  if (q.t === 'wf') return 'wf';
  if (q.t === 'reihe') return 'reihe';
  if (q.t === 'zahl') return 'zahl';
  if (q.t === 'karte' || !(q.x && q.x.length)) return 'karte';
  const k = Z.karten[q.id];
  if (q.tx && q.tx.length && k && (k.stufe || 0) >= 2) return 'frei';
  return 'mc';
}

// ───────── Freitext tolerant vergleichen ─────────
function norm(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9,]/g, ' ')
    .replace(/\b(der|die|das|den|dem|the|ein|eine|im|in|am|ca|ungefaehr)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
function freitextRichtig(eingabe, q) {
  const e = norm(eingabe);
  if (!e) return false;
  return (q.tx || [q.a]).some(t => {
    const n = norm(t);
    if (/^[0-9,]+$/.test(n)) return e.replace(/\s/g, '') === n || e.split(' ').includes(n);
    const erlaubt = n.length <= 4 ? 0 : n.length <= 8 ? 1 : 2;
    return lev(e, n) <= erlaubt || (n.length >= 5 && e.includes(n));
  });
}

// ───────── Rechenaufgaben: Zahl mit Toleranz ─────────
const zahlLesen = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
const zahlText = n => String(n).replace('.', ',');
function zahlRichtig(eingabe, q) {
  const v = zahlLesen(eingabe);
  if (!isFinite(v)) return false;
  const tol = q.tol ?? Math.max(Math.abs(q.a) * 0.01, 0.0001);
  return Math.abs(v - q.a) <= tol + 1e-9;
}

// ───────── Navigation ─────────
let tab = 'heute';
let sitzung = null;
function zeigeTabs(sichtbar) {
  const nav = $('#tabs');
  if (!sichtbar) { nav.innerHTML = ''; nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  const t = [['heute', '⚡', 'Heute'], ['ueben', '📚', 'Üben'], ['anlagen', '🏭', 'Anlagen'], ['statistik', '📊', 'Statistik'], ['mehr', '⚙️', 'Mehr']];
  nav.innerHTML = t.map(([id, i, n]) => `<button class="${tab === id ? 'aktiv' : ''}" data-tab="${id}"><span>${i}</span>${n}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
}
function render() {
  if (!Z.setup.fertig) return renderSetup();
  if (!Z.einstufung.fertig && !sitzung) return renderEinstufungStart();
  if (sitzung) return renderFrage();
  zeigeTabs(true);
  ({ heute: renderHeute, ueben: renderUeben, anlagen: renderAnlagen, statistik: renderStatistik, mehr: renderMehr })[tab]();
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('zeigen');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('zeigen'), 2800);
}
function modal(html, beiOk) {
  const m = $('#modal');
  m.innerHTML = `<div class="box">${html}<div class="reihe2"><button class="btn zweit" id="mAbbr">Abbrechen</button><button class="btn" id="mOk">OK</button></div></div>`;
  m.classList.remove('hidden');
  $('#mAbbr').onclick = () => m.classList.add('hidden');
  $('#mOk').onclick = () => { if (beiOk() !== false) m.classList.add('hidden'); };
}

// ───────── Einrichtung (beim ersten Start) ─────────
let setupSchritt = 0;
const logoHtml = (klein) => `<div class="logo${klein ? ' klein' : ''}">SCHALT<span class="blitz">⚡</span>ZENTRALE</div>`;
function renderSetup() {
  zeigeTabs(false);
  const S = Z.setup;
  const schritte = [
    () => `<div class="hero">${logoHtml()}<p>Fachwissen für Instandhaltung und Störungsdienst.</p></div>
      <div class="karte"><p>SPS, Frequenzumrichter, Regelungstechnik, Antriebe und Sensorik – in vier Stufen von Geselle bis Ingenieur. Jede Antwort mit Erklärung und Quelle.</p>
      <p class="leise">Zwei kurze Fragen, dann ein Einstufungstest.</p></div>
      <button class="btn gross" id="weiter">Los geht's</button>`,
    () => `<h2>Was brauchst du am meisten?</h2><p class="leise">Themen mit „wenig“ kommen seltener dran, „viel“ öfter.</p>
      ${KATEGORIEN.map(k => `<div class="interesse"><span>${k.icon} ${k.name}</span><div class="seg" data-k="${k.id}">
        ${['wenig', 'normal', 'viel'].map((n, i) => `<button class="${(S.interessen[k.id] ?? 1) === i ? 'an' : ''}" data-v="${i}">${n}</button>`).join('')}
      </div></div>`).join('')}
      <button class="btn gross" id="weiter">Weiter</button>`,
    () => `<h2>Wann lernst du am ehesten?</h2>
      ${[['morgen', 'Morgens'], ['mittag', 'In der Pause'], ['abend', 'Abends'], ['flexibel', 'Unterschiedlich']]
        .map(([v, t]) => `<button class="wahl ${S.tageszeit === v ? 'an' : ''}" data-zeit="${v}"><b>${t}</b></button>`).join('')}
      <h2>Wie viel Zeit pro Tag?</h2>
      <div class="seg breit" id="minuten">${[5, 10, 20].map(m => `<button class="${S.minuten === m ? 'an' : ''}" data-v="${m}">${m} Min</button>`).join('')}</div>
      <p class="leise">Für den Streak zählen 5 Minuten, und zwar nur Montag bis Freitag. Am Wochenende kannst du lernen, musst aber nicht.</p>
      <button class="btn gross" id="weiter">Fertig</button>`,
  ];
  $('#app').innerHTML = `<div class="setup">${schritte[setupSchritt]()}<div class="punkte">${schritte.map((_, i) => `<i class="${i === setupSchritt ? 'an' : ''}"></i>`).join('')}</div></div>`;
  document.querySelectorAll('.seg[data-k] button').forEach(b => b.onclick = () => { S.interessen[b.parentNode.dataset.k] = +b.dataset.v; renderSetup(); });
  document.querySelectorAll('[data-zeit]').forEach(b => b.onclick = () => { S.tageszeit = b.dataset.zeit; renderSetup(); });
  document.querySelectorAll('#minuten button').forEach(b => b.onclick = () => { S.minuten = +b.dataset.v; renderSetup(); });
  $('#weiter').onclick = () => {
    if (setupSchritt < schritte.length - 1) { setupSchritt++; renderSetup(); window.scrollTo(0, 0); return; }
    KATEGORIEN.forEach(k => S.interessen[k.id] ??= 1);
    S.fertig = true; Z.neuProTag = S.minuten >= 20 ? 15 : S.minuten <= 5 ? 6 : 10; speichern(); render();
  };
}

// ───────── Einstufungstest ─────────
function renderEinstufungStart() {
  zeigeTabs(false);
  $('#app').innerHTML = `<div class="setup"><h2>Einstufungstest</h2>
    <div class="karte"><p>Pro Thema je eine Frage aus jeder Stufe: Geselle, Praxis, Werkmeister, Ingenieur. Danach startet jedes Thema auf deiner Stufe.</p>
    <p class="leise">20 Fragen, ca. 8–10 Minuten. Nicht raten, lieber „Weiß ich nicht“ drücken, sonst stimmt die Einstufung nicht.</p></div>
    <button class="btn gross" id="los">Test starten</button>
    <button class="btn zweit" id="ueberspringen">Überspringen, alles bei „Geselle“</button></div>`;
  $('#los').onclick = () => {
    const liste = [];
    KATEGORIEN.forEach(k => [1, 2, 3, 4].forEach(n => {
      const q = mischen(FRAGEN.filter(f => f.k === k.id && f.n === n && f.t !== 'reihe'))[0];
      if (q) liste.push(q.id);
    }));
    sitzung = { modus: 'einstufung', liste: liste, pos: 0, ergebnis: {}, beantwortet: 0, richtig: 0, gesehen: new Set(), nochmal: [] };
    naechsteKarte();
  };
  $('#ueberspringen').onclick = () => { Z.einstufung.fertig = true; speichern(); render(); };
}
function einstufungAbschliessen() {
  const erg = sitzung.ergebnis;
  KATEGORIEN.forEach(k => {
    const r = erg[k.id] || 0;
    Z.einstufung.start[k.id] = Math.max(1, Math.min(4, r));
    Z.stufe[k.id] = Z.einstufung.start[k.id];
  });
  Z.einstufung.fertig = true; speichern();
  const zeilen = KATEGORIEN.map(k => `<div class="zeile"><span>${k.icon} ${k.name}</span><b>${STUFEN[Z.stufe[k.id] - 1]}</b></div>`).join('');
  sitzung = null;
  zeigeTabs(false);
  $('#app').innerHTML = `<div class="setup"><h2>Deine Startstufen</h2><div class="karte">${zeilen}</div>
    <p class="leise">Richtig beantwortete Fragen sind schon eingeplant. Kannst du ca. 80 % einer Stufe sicher, schaltet sich die nächste frei. Unter „Üben“ kannst du die Stufe auch selbst umstellen.</p>
    <button class="btn gross" id="ok">Zur App</button></div>`;
  $('#ok').onclick = () => { tab = 'heute'; render(); };
}

// ───────── Heute ─────────
const awlKachel = () => `<a class="karte awl" href="${AWL_LINK}" target="_blank" rel="noopener"><span class="ic">🖥️</span>
  <span><b>AWL Störungsdienst</b><small>Fehlersuche in Step-7-Programmen üben (online, eigener Fortschritt)</small></span></a>`;
function renderHeute() {
  streakPruefen();
  const t = tagHeute(), s = Z.streak, l = level(Z.xp), we = !werktag(heute());
  const fortschritt = Math.min(1, t.sek / ZIEL_SEK), vorschlag = vorschlagMinuten();
  const fae = faellige().length, neuRest = Math.max(0, Z.neuProTag - t.neu), neuDa = neueFragen().filter(q => q.eigen || q.n <= aktStufe(q.k)).length;
  const xpL = xpFuer(l), xpN = xpFuer(l + 1);
  $('#app').innerHTML = `
    <header class="kopf">${logoHtml(true)}<div class="lvl">Level ${l}</div></header>
    <div class="streak karte">
      <div class="flamme ${t.ziel && !we ? 'an' : ''}">🔥<b>${s.n}</b></div>
      <div><b>${s.n === 1 ? '1 Tag' : s.n + ' Tage'} Streak (Mo–Fr)</b><small>Bestwert ${s.best} · 🛡️ ${s.schutz} Schutztag${s.schutz === 1 ? '' : 'e'}</small></div>
    </div>
    ${we ? '<div class="karte">🛋️ <b>Wochenende</b><small class="leise">Zählt nicht für den Streak. Wenn du lernst, gibt es trotzdem XP.</small></div>' : ''}
    <div class="karte">
      <div class="zeile"><b>Tagesziel 5 Minuten</b><span>${Math.floor(t.sek / 60)}:${String(Math.floor(t.sek % 60)).padStart(2, '0')}</span></div>
      <div class="balken"><i style="width:${fortschritt * 100}%"></i></div>
      <small class="leise">${t.ziel ? '✓ Ziel erreicht – alles Weitere ist Bonus.' : 'Danach kannst du jederzeit aufhören oder weitermachen.'}</small>
    </div>
    <div class="karte vorschlag">
      <div><small class="leise">Vorschlag für heute</small><b>ca. ${vorschlag} Minuten</b></div>
      <div class="mini"><span><b>${fae}</b> fällig</span><span><b>${Math.min(neuRest, neuDa)}</b> neu</span></div>
    </div>
    <button class="btn gross" id="start">${t.fragen ? 'Weiterlernen' : 'Tagesrunde starten'}</button>
    ${awlKachel()}
    <div class="karte"><div class="zeile"><span>XP ${Z.xp}</span><small class="leise">noch ${xpN - Z.xp} bis Level ${l + 1}</small></div>
      <div class="balken gold"><i style="width:${(Z.xp - xpL) / (xpN - xpL) * 100}%"></i></div></div>`;
  $('#start').onclick = () => starteSitzung('tag');
}

function starteSitzung(modus, kat) {
  sitzung = { modus, kat, warteschlange: [], gesehen: new Set(), nochmal: [], beantwortet: 0, richtig: 0, extraNeu: 0, zielGezeigt: tagHeute().ziel };
  naechsteKarte();
}

// ───────── Lernrunde ─────────
function naechsteKarte() {
  const s = sitzung;
  let q = null;
  if (s.modus === 'einstufung') {
    if (s.pos >= s.liste.length) return einstufungAbschliessen();
    q = frageVon(s.liste[s.pos++]);
  } else {
    // 1) falsch beantwortete Fragen nach ca. 4 anderen nochmal
    const nochmal = s.nochmal.find(n => s.beantwortet - n.bei >= 4);
    if (nochmal) { s.nochmal = s.nochmal.filter(n => n !== nochmal); q = frageVon(nochmal.id); }
    // 2) fällige Wiederholungen
    if (!q) q = faellige(s.kat).find(f => !s.gesehen.has(f.id));
    // 3) neue Fragen (im Tagesmix bis zum Tageslimit, danach nur auf Wunsch)
    if (!q) {
      const darf = s.modus === 'kategorie' || tagHeute().neu < Z.neuProTag + s.extraNeu;
      if (darf) q = naechsteNeue(s.kat, s.gesehen);
    }
    if (!q && s.nochmal.length) { const n = s.nochmal.shift(); q = frageVon(n.id); }
    if (!q) return renderFertig();
  }
  s.gesehen.add(q.id);
  s.aktuell = { q, format: s.modus === 'einstufung' && q.t === 'mc' ? 'mc' : formatFuer(q), start: Date.now(), antwort: null };
  if (s.aktuell.format === 'mc') s.aktuell.optionen = mischen([q.a, ...q.x.slice(0, 3)]);
  if (s.aktuell.format === 'reihe') { let m; do { m = mischen(q.r); } while (q.r.length > 1 && m.join() === q.r.join()); s.aktuell.reihe = m; s.aktuell.auswahl = []; }
  render();
}

function kopfzeile() {
  const s = sitzung, t = tagHeute();
  const info = s.modus === 'einstufung' ? `Einstufung ${s.pos}/${s.liste.length}` : `${Math.floor(t.sek / 60)} Min · ${s.richtig}/${s.beantwortet} richtig`;
  return `<div class="sitzkopf"><button class="x" id="beenden">✕</button><span>${info}</span>
    ${s.modus !== 'einstufung' ? `<div class="balken duenn"><i style="width:${Math.min(100, t.sek / ZIEL_SEK * 100)}%"></i></div>` : ''}</div>`;
}

function renderFrage() {
  zeigeTabs(false);
  const s = sitzung, a = s.aktuell, q = a.q;
  if (a.antwort) return renderErklaerung();
  const neu = !Z.karten[q.id]?.last;
  let koerper = '';
  if (a.format === 'mc') {
    koerper = a.optionen.map((o, i) => `<button class="option" data-i="${i}">${esc(o)}</button>`).join('');
  } else if (a.format === 'wf') {
    koerper = `<div class="reihe2"><button class="option wf" data-wf="1">✓ Stimmt</button><button class="option wf" data-wf="0">✗ Stimmt nicht</button></div>`;
  } else if (a.format === 'frei') {
    koerper = `<input id="frei" class="eingabe" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Antwort eintippen …">
      <button class="btn gross" id="pruefen">Prüfen</button><small class="leise">Kleine Tippfehler sind okay.</small>`;
  } else if (a.format === 'reihe') {
    koerper = `<div class="gewaehlt">${a.auswahl.map((x, i) => `<div class="chip an">${i + 1}. ${esc(x)}</div>`).join('') || '<small class="leise">Tippe die Einträge in der richtigen Reihenfolge an.</small>'}</div>
      ${a.reihe.filter(x => !a.auswahl.includes(x)).map(x => `<button class="option" data-r="${esc(x)}">${esc(x)}</button>`).join('')}
      ${a.auswahl.length ? '<button class="btn zweit" id="zurueck">Zurücksetzen</button>' : ''}`;
  } else if (a.format === 'zahl') {
    koerper = `<input id="zahl" class="eingabe zahl" inputmode="decimal" autocomplete="off" placeholder="Ergebnis">
      ${q.einheit ? `<div class="einheit">${esc(q.einheit)}</div>` : ''}
      <button class="btn gross" id="pruefenZahl">Prüfen</button><small class="leise">Komma oder Punkt, beides geht. Kleine Rundungsunterschiede sind okay.</small>`;
  } else if (a.format === 'karte') {
    koerper = `<button class="btn gross" id="zeigen">Antwort zeigen</button>`;
  }
  $('#app').innerHTML = `${kopfzeile()}
    <div class="frage">
      <div class="kat">${katIcon(q.k)} ${esc(katName(q.k))}${q.eigen ? '' : `<span class="stufe-tag">${STUFEN[q.n - 1]}</span>`}${q.sz ? '<span class="szenario">🔧 Störung</span>' : ''}${neu && s.modus !== 'einstufung' ? ' · <span class="neu">neu</span>' : ''}${a.format === 'frei' ? ' · ✍️ Freitext' : ''}${a.format === 'zahl' ? ' · 🧮 Rechnen' : ''}</div>
      <h1>${esc(q.f)}</h1>
      <div class="antworten">${koerper}</div>
      <button class="btn zweit" id="weissnicht">🤷 Weiß ich nicht</button>
    </div>`;
  $('#beenden').onclick = beenden;
  document.querySelectorAll('[data-i]').forEach(b => b.onclick = () => antworten(a.optionen[+b.dataset.i] === q.a, a.optionen[+b.dataset.i]));
  document.querySelectorAll('[data-wf]').forEach(b => b.onclick = () => antworten((b.dataset.wf === '1') === q.w, b.dataset.wf === '1' ? 'Stimmt' : 'Stimmt nicht'));
  document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    a.auswahl.push(b.dataset.r);
    if (a.auswahl.length === q.r.length) antworten(a.auswahl.join('|') === q.r.join('|'), a.auswahl.join(' → '));
    else renderFrage();
  });
  if ($('#zurueck')) $('#zurueck').onclick = () => { a.auswahl = []; renderFrage(); };
  if ($('#pruefen')) {
    const f = $('#frei'); f.focus();
    const pr = () => { if (f.value.trim()) antworten(freitextRichtig(f.value, q), f.value.trim()); };
    $('#pruefen').onclick = pr; f.onkeydown = e => { if (e.key === 'Enter') pr(); };
  }
  if ($('#pruefenZahl')) {
    const f = $('#zahl'); f.focus();
    const pr = () => { if (f.value.trim()) antworten(zahlRichtig(f.value, q), f.value.trim() + (q.einheit ? ' ' + q.einheit : '')); };
    $('#pruefenZahl').onclick = pr; f.onkeydown = e => { if (e.key === 'Enter') pr(); };
  }
  if ($('#zeigen')) $('#zeigen').onclick = () => { a.aufgedeckt = true; renderKarteSelbst(); };
  $('#weissnicht').onclick = () => { a.weissNicht = true; antworten(false, ''); };
}

// Karteikarte (eigene Fragen ohne Auswahlantworten): selbst bewerten
function renderKarteSelbst() {
  const a = sitzung.aktuell, q = a.q;
  $('#app').innerHTML = `${kopfzeile()}<div class="frage"><div class="kat">${katIcon(q.k)} ${esc(katName(q.k))}</div><h1>${esc(q.f)}</h1>
    <div class="karte loesung"><b>${esc(q.a)}</b></div><p class="leise">Wusstest du es?</p>
    <div class="reihe2"><button class="btn zweit" id="nein">✗ Nein</button><button class="btn" id="ja">✓ Ja</button></div></div>`;
  $('#beenden').onclick = beenden;
  $('#nein').onclick = () => antworten(false, '');
  $('#ja').onclick = () => antworten(true, '');
}

function antworten(richtig, eingabe) {
  const a = sitzung.aktuell;
  a.dauer = (Date.now() - a.start) / 1000;
  a.antwort = { richtig, eingabe };
  a.erklStart = Date.now();
  renderErklaerung();
}

function noteBerechnen(a, geraten) {
  if (!a.antwort.richtig || geraten) return 1;
  const k = Z.karten[a.q.id];
  const schnell = a.format === 'zahl' ? 20 : a.format === 'frei' ? 10 : a.format === 'reihe' ? 15 : 6;
  const langsam = a.format === 'zahl' ? 90 : a.format === 'frei' ? 30 : a.format === 'reihe' ? 45 : 30;
  if (a.dauer > langsam) return 2;
  if (a.dauer < schnell && k?.last) return 4;
  return 3;
}

function renderErklaerung() {
  const s = sitzung, a = s.aktuell, q = a.q, r = a.antwort.richtig;
  const loesung = q.t === 'wf' ? (q.w ? 'Stimmt' : 'Stimmt nicht') : q.t === 'reihe' ? q.r.join(' → ') : q.t === 'zahl' ? `${zahlText(q.a)}${q.einheit ? ' ' + q.einheit : ''}` : q.a;
  const zuklappen = false;
  $('#app').innerHTML = `${kopfzeile()}
    <div class="frage">
      <div class="ergebnis ${r ? 'gut' : a.weissNicht ? '' : 'schlecht'}">${r ? '✓ Richtig!' : a.weissNicht ? '💡 Jetzt weißt du es' : '✗ Leider falsch'}</div>
      <h1 class="klein">${esc(q.f)}</h1>
      ${!r && a.antwort.eingabe ? `<p class="deine">Deine Antwort: ${esc(a.antwort.eingabe)}</p>` : ''}
      <div class="karte loesung"><small class="leise">Richtige Antwort</small><b>${esc(loesung)}</b></div>
      <details class="karte erkl" ${zuklappen ? '' : 'open'}><summary>💡 Erklärung</summary>
        <p>${esc(q.e || '')}</p>
        ${q.st ? `<p class="stand ${abgelaufen(q) ? 'alt' : ''}">${abgelaufen(q) ? '⚠️ Eventuell veraltet – ' : '🕒 '}Stand: ${q.st}</p>` : ''}
        ${q.q ? `<a class="quelle" href="${esc(q.q)}" target="_blank" rel="noopener">🔗 Quelle: ${esc(q.qn || 'Mehr dazu')}</a>` : q.qn ? `<p class="quelle">📚 Quelle: ${esc(q.qn)}</p>` : ''}
      </details>
      <div class="aktionen">
        ${r && s.modus !== 'einstufung' && a.format !== 'karte' ? '<button class="btn zweit" id="geraten">War geraten</button>' : ''}
        <button class="btn zweit" id="melden">⚑ Melden</button>
      </div>
      <button class="btn gross" id="weiter">Weiter</button>
    </div>`;
  $('#beenden').onclick = () => { verbuchen(false); beenden(); };
  $('#weiter').onclick = () => { verbuchen(false); weiterNachAntwort(); };
  if ($('#geraten')) $('#geraten').onclick = () => { verbuchen(true); toast('Okay, kommt bald wieder dran'); weiterNachAntwort(); };
  $('#melden').onclick = () => melden(q);
}

function verbuchen(geraten) {
  const s = sitzung, a = s.aktuell;
  if (!a || a.verbucht) return;
  a.verbucht = true;
  const q = a.q, t = tagHeute(), richtig = a.antwort.richtig && !geraten;
  const aktiv = Math.min(a.dauer, 60) + Math.min((Date.now() - a.erklStart) / 1000, 40);
  t.sek += aktiv; t.fragen++; s.beantwortet++;
  if (richtig) { t.richtig++; s.richtig++; }
  if (s.modus === 'einstufung') {
    if (richtig) {
      s.ergebnis[q.k] = (s.ergebnis[q.k] || 0) + 1;
      Z.karten[q.id] = Object.assign(FSRS.bewerten({}, 3), { stufe: 1, richtig: 1, falsch: 0 });
    }
    speichern(); return;
  }
  const alt = Z.karten[q.id] || {};
  if (!alt.last) t.neu++;
  const note = noteBerechnen(a, geraten);
  const k = Object.assign(FSRS.bewerten(alt, note), {
    stufe: note === 1 ? Math.max(0, (alt.stufe || 0) - 1) : (alt.stufe || 0) + 1,
    richtig: (alt.richtig || 0) + (richtig ? 1 : 0), falsch: (alt.falsch || 0) + (richtig ? 0 : 1),
  });
  Z.karten[q.id] = k;
  if (note === 1) s.nochmal.push({ id: q.id, bei: s.beantwortet });
  const xp = richtig ? (a.format === 'frei' || a.format === 'zahl' ? 15 : 10) + (q.n - 1) * 2 : 2;
  Z.xp += xp; t.xp += xp;
  speichern();
  if (!q.eigen) stufeFreischalten(q.k);
}

function weiterNachAntwort() {
  const s = sitzung;
  if (s.modus !== 'einstufung' && !s.zielGezeigt && tagHeute().sek >= ZIEL_SEK) {
    s.zielGezeigt = true; zielErreicht();
    zeigeTabs(false);
    $('#app').innerHTML = `<div class="setup mitte"><div class="feier">🔥</div><h2>Tagesziel erreicht!</h2>
      <p>Streak: <b>${Z.streak.n} ${Z.streak.n === 1 ? 'Tag' : 'Tage'}</b> · +50 XP</p>
      <p class="leise">Heute vorgeschlagen: ca. ${vorschlagMinuten()} Minuten. Alles Weitere ist Bonus.</p>
      <button class="btn gross" id="weiter">Weiterlernen</button><button class="btn zweit" id="schluss">Schluss für heute</button></div>`;
    $('#weiter').onclick = naechsteKarte;
    $('#schluss').onclick = beenden;
    return;
  }
  naechsteKarte();
}

function renderFertig() {
  const s = sitzung, neuDa = neueFragen(s.kat).filter(q => q.eigen || q.n <= aktStufe(q.k)).length;
  zeigeTabs(false);
  $('#app').innerHTML = `<div class="setup mitte"><div class="feier">✅</div><h2>${s.modus === 'kategorie' ? 'Thema durch!' : 'Alles erledigt für heute'}</h2>
    <p>${s.richtig} von ${s.beantwortet} richtig</p>
    ${s.modus === 'tag' && neuDa ? `<button class="btn gross" id="mehr">5 weitere neue Fragen</button>` : ''}
    ${!neuDa ? '<p class="leise">Alle Fragen deiner aktuellen Stufen sind gesehen. Die nächste Stufe schaltet sich frei, sobald du ca. 80 % sicher kannst – oder stell sie unter „Üben“ selbst um.</p>' : ''}
    <button class="btn ${s.modus === 'tag' && neuDa ? 'zweit' : 'gross'}" id="schluss">Zurück</button></div>`;
  if ($('#mehr')) $('#mehr').onclick = () => { s.extraNeu += 5; naechsteKarte(); };
  $('#schluss').onclick = beenden;
}

function beenden() {
  if (sitzung?.modus === 'einstufung') {
    if (sitzung.aktuell?.antwort) verbuchen(false);
    return einstufungAbschliessen();
  }
  if (sitzung?.aktuell?.antwort) verbuchen(false);
  if (!tagHeute().ziel && tagHeute().sek >= ZIEL_SEK) zielErreicht();
  sitzung = null; tab = 'heute'; render();
}

// ───────── Melden ─────────
function melden(q) {
  modal(`<h3>Frage melden</h3><p class="leise">${esc(q.f)}</p>
    <textarea id="mText" rows="4" placeholder="Was stimmt nicht? (z. B. Fakt falsch, veraltet, unklar)"></textarea>`, () => {
    const text = $('#mText').value.trim();
    if (!text) return false;
    Z.meldungen.push({ id: q.id, frage: q.f, text, datum: heute() }); speichern(); toast('Danke, gemeldet. Kommt in den Export.');
  });
}

// ───────── Üben (Themen + Stufe umstellen) ─────────
function renderUeben() {
  $('#app').innerHTML = `<header class="kopf"><h2>Üben</h2></header>
    <p class="leise">Gezielt ein Thema lernen: fällige Wiederholungen und neue Fragen bis zu deiner Stufe, ohne Tageslimit.</p>
    ${KATEGORIEN.map(k => {
      const alle = alleFragen().filter(q => q.k === k.id), ges = alle.filter(q => Z.karten[q.id]?.last).length;
      const fae = faellige(k.id).length, st = aktStufe(k.id);
      return `<button class="katkarte" data-k="${k.id}"><span class="ic">${k.icon}</span><span class="txt"><b>${k.name}</b>
        <small>${ges}/${alle.length} gelernt${fae ? ` · <em>${fae} fällig</em>` : ''}</small></span><span class="pfeil">›</span></button>
        <div class="stufenwahl"><div class="seg" data-st="${k.id}">${STUFEN.map((n, i) => `<button class="${st === i + 1 ? 'an' : ''}" data-v="${i + 1}">${n}</button>`).join('')}</div></div>`;
    }).join('')}
    ${awlKachel()}`;
  document.querySelectorAll('.katkarte').forEach(b => b.onclick = () => starteSitzung('kategorie', b.dataset.k));
  document.querySelectorAll('[data-st] button').forEach(b => b.onclick = () => {
    Z.stufe[b.parentNode.dataset.st] = +b.dataset.v; speichern(); toast(`Stufe ${STUFEN[+b.dataset.v - 1]} eingestellt`); renderUeben();
  });
}

// ───────── Anlagen (eigene Notizen, nur auf diesem Handy) ─────────
let anlageOffen = null;
function renderAnlagen() {
  const A = Z.anlagen;
  if (anlageOffen !== null && A[anlageOffen]) return renderAnlage(A[anlageOffen]);
  anlageOffen = null;
  $('#app').innerHTML = `<header class="kopf"><h2>Anlagen</h2></header>
    <p class="leise">Deine eigenen Notizen zu Maschinen und Störungen. Sie liegen nur auf diesem Handy und stehen nie im öffentlichen App-Code. Über „Sichern“ unter „Mehr“ kommen sie mit in die Sicherung.</p>
    ${A.map((x, i) => `<button class="katkarte anlage" data-a="${i}"><span class="ic">🏭</span><span class="txt"><b>${esc(x.name)}</b>
      <small>${x.notizen.length} Notiz${x.notizen.length === 1 ? '' : 'en'}${x.info ? ' · ' + esc(x.info) : ''}</small></span><span class="pfeil">›</span></button>`).join('')
      || '<div class="leer">Noch keine Anlage angelegt.</div>'}
    <button class="btn gross" id="neuAnlage">+ Anlage hinzufügen</button>`;
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { anlageOffen = +b.dataset.a; renderAnlagen(); });
  $('#neuAnlage').onclick = () => modal(`<h3>Neue Anlage</h3><input id="aN" placeholder="Name, z. B. Maschine 1 *"><input id="aI" placeholder="Steuerung / Kurzinfo (optional)">`, () => {
    const n = $('#aN').value.trim(); if (!n) { toast('Namen eingeben'); return false; }
    A.push({ name: n, info: $('#aI').value.trim(), notizen: [] }); speichern(); renderAnlagen();
  });
}
function renderAnlage(x) {
  $('#app').innerHTML = `<header class="kopf"><button class="x" id="zurueckA">‹</button><h2>${esc(x.name)}</h2><span></span></header>
    ${x.info ? `<p class="leise">${esc(x.info)}</p>` : ''}
    <button class="btn gross" id="neuNotiz">+ Störung / Notiz eintragen</button>
    <div class="karte">${x.notizen.slice().reverse().map((n, ri) => { const i = x.notizen.length - 1 - ri; return `<div class="notiz">
      <div class="zeile"><small class="leise">${esc(n.datum)}</small><button class="mini-x" data-dn="${i}">✕</button></div>
      ${n.fehler ? `<p><b>Fehlerbild:</b> ${esc(n.fehler)}</p>` : ''}${n.ursache ? `<p><b>Ursache:</b> ${esc(n.ursache)}</p>` : ''}
      ${n.loesung ? `<p><b>Lösung:</b> ${esc(n.loesung)}</p>` : ''}${n.teile ? `<p><b>Bausteine/Geräte:</b> ${esc(n.teile)}</p>` : ''}</div>`; }).join('')
      || '<div class="leer">Noch keine Einträge.</div>'}</div>
    <div class="reihe2"><button class="btn zweit" id="mdKopie">Kopieren für Vault</button><button class="btn gefahr" id="delA">Anlage löschen</button></div>`;
  $('#zurueckA').onclick = () => { anlageOffen = null; renderAnlagen(); };
  $('#neuNotiz').onclick = () => modal(`<h3>Eintrag: ${esc(x.name)}</h3>
    <input id="nF" placeholder="Fehlerbild *"><input id="nU" placeholder="Ursache"><input id="nL" placeholder="Lösung">
    <input id="nT" placeholder="Bausteine, Variablen, Geräte (z. B. FU-Typ)">`, () => {
    const f = $('#nF').value.trim(); if (!f) { toast('Fehlerbild eingeben'); return false; }
    x.notizen.push({ datum: heute(), fehler: f, ursache: $('#nU').value.trim(), loesung: $('#nL').value.trim(), teile: $('#nT').value.trim() });
    speichern(); renderAnlagen();
  });
  document.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => modal('<h3>Eintrag löschen?</h3>', () => { x.notizen.splice(+b.dataset.dn, 1); speichern(); renderAnlagen(); }));
  $('#delA').onclick = () => modal(`<h3>„${esc(x.name)}“ löschen?</h3><p class="leise">Alle Einträge dieser Anlage gehen verloren.</p>`, () => { Z.anlagen.splice(anlageOffen, 1); anlageOffen = null; speichern(); renderAnlagen(); });
  $('#mdKopie').onclick = () => {
    const z = s => String(s || '').replace(/\|/g, '/');
    const md = `## Störungs-Log ${x.name}\n| Datum | Fehlerbild | Ursache | Lösung | Bausteine/Geräte |\n|---|---|---|---|---|\n` +
      x.notizen.map(n => `| ${n.datum} | ${z(n.fehler)} | ${z(n.ursache)} | ${z(n.loesung)} | ${z(n.teile)} |`).join('\n');
    navigator.clipboard?.writeText(md).then(() => toast('Kopiert – in Obsidian einfügen oder Claude schicken'), () => toast('Kopieren nicht möglich'));
  };
  window.scrollTo(0, 0);
}

// ───────── Statistik ─────────
function renderStatistik() {
  const fr = alleFragen(), gelernt = fr.filter(q => Z.karten[q.id]?.last);
  const sicher = gelernt.filter(q => Z.karten[q.id].s >= 21).length;
  const r = gelernt.reduce((s, q) => s + (Z.karten[q.id].richtig || 0), 0), f = gelernt.reduce((s, q) => s + (Z.karten[q.id].falsch || 0), 0);
  const tage = [...Array(7)].map((_, i) => heute(new Date(Date.now() - (6 - i) * TAG)));
  const maxSek = Math.max(ZIEL_SEK, ...tage.map(d => Z.tage[d]?.sek || 0));
  const wt = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const katZeilen = KATEGORIEN.map(k => {
    const alle = fr.filter(q => q.k === k.id), g = alle.filter(q => Z.karten[q.id]?.last);
    const si = g.filter(q => Z.karten[q.id].s >= 21).length;
    const kr = g.reduce((s, q) => s + (Z.karten[q.id].richtig || 0), 0), kf = g.reduce((s, q) => s + (Z.karten[q.id].falsch || 0), 0);
    return { k, alle: alle.length, g: g.length, si, quote: kr + kf ? Math.round(kr / (kr + kf) * 100) : null };
  });
  const bewertet = katZeilen.filter(z => z.quote !== null && z.g >= 3).sort((a, b) => a.quote - b.quote);
  $('#app').innerHTML = `<header class="kopf"><h2>Statistik</h2></header>
    <div class="kacheln">
      <div class="kachel"><b>${sicher}</b><small>Fragen sicher gemerkt</small></div>
      <div class="kachel"><b>${gelernt.length}</b><small>von ${fr.length} gelernt</small></div>
      <div class="kachel"><b>${r + f ? Math.round(r / (r + f) * 100) + ' %' : '–'}</b><small>Trefferquote</small></div>
      <div class="kachel"><b>${Z.streak.best}</b><small>bester Streak (Mo–Fr)</small></div>
    </div>
    <div class="karte"><b>Letzte 7 Tage</b><div class="woche">${tage.map(d => {
      const t = Z.tage[d], h = (t?.sek || 0) / maxSek * 100, g = Z.streak.geschuetzt.includes(d);
      return `<div class="tagbalken"><i class="${t?.ziel ? 'ziel' : ''}" style="height:${Math.max(2, h)}%"></i><small>${g ? '🛡️' : wt[new Date(d + 'T12:00').getDay()]}</small></div>`;
    }).join('')}</div><small class="leise">Gold = Tagesziel erreicht · 🛡️ = Schutztag</small></div>
    ${bewertet.length >= 2 ? `<div class="karte"><div class="zeile"><span>💪 Stärkstes Thema</span><b>${bewertet[bewertet.length - 1].k.name}</b></div>
      <div class="zeile"><span>🎯 Hier üben lohnt sich</span><b>${bewertet[0].k.name}</b></div></div>` : ''}
    <div class="karte"><b>Pro Thema</b>${katZeilen.map(z => `<div class="katstat"><div class="zeile"><span>${z.k.icon} ${z.k.name}</span>
      <small>${z.quote !== null ? z.quote + ' % richtig' : 'noch nicht gelernt'}</small></div>
      <div class="balken doppelt"><i class="g" style="width:${z.g / z.alle * 100}%"></i><i class="s" style="width:${z.si / z.alle * 100}%"></i></div>
      <small class="leise">Stufe ${STUFEN[aktStufe(z.k.id) - 1]} · ${z.si} sicher · ${z.g} gelernt · ${z.alle} gesamt</small></div>`).join('')}
      <small class="leise">„Sicher“ = du würdest dich laut Wiederholungssystem auch in 3 Wochen noch mit 90 % Wahrscheinlichkeit erinnern.</small></div>`;
}

// ───────── Mehr ─────────
function renderMehr() {
  const abgel = alleFragen().filter(abgelaufen);
  $('#app').innerHTML = `<header class="kopf"><h2>Mehr</h2></header>
    <div class="karte"><b>✍️ Eigene Fragen</b><p class="leise">Etwas an der Maschine gelernt? Als Frage speichern, dann kommt es ins Wiederholungssystem.</p>
      <button class="btn" id="eigeneNeu">Frage hinzufügen</button>
      ${(Z.eigene || []).map(q => `<div class="zeile eigen"><span>${katIcon(q.k)} ${esc(q.f)}</span><button class="mini-x" data-del="${q.id}">✕</button></div>`).join('')}</div>
    <div class="karte"><b>⚑ Gemeldete Fragen (${Z.meldungen.length})</b>
      ${Z.meldungen.map(m => `<div class="meldung"><small>${m.datum}</small><b>${esc(m.frage)}</b><p>${esc(m.text)}</p></div>`).join('') || '<p class="leise">Keine Meldungen.</p>'}
      ${Z.meldungen.length ? '<div class="reihe2"><button class="btn zweit" id="mKopieren">Kopieren für Claude</button><button class="btn zweit" id="mLeeren">Liste leeren</button></div>' : ''}</div>
    ${abgel.length ? `<div class="karte warn"><b>⚠️ Abgelaufene Fragen</b>${abgel.map(q => `<p>${esc(q.f)} <small>(Stand ${q.st})</small></p>`).join('')}<small>Sag Claude Bescheid, dann werden sie aktualisiert.</small></div>` : ''}
    <div class="karte"><b>⏰ Tägliche Erinnerung</b><p class="leise">So geht's mit der App „Kurzbefehle“ am iPhone:</p>
      <ol class="anleitung"><li>Kurzbefehle öffnen → unten „Automation“ → „+“</li><li>„Tageszeit“ wählen, Uhrzeit ${({ morgen: 'z. B. 7:00', mittag: 'z. B. 12:00', abend: 'z. B. 19:30', flexibel: 'nach Wunsch' })[Z.setup.tageszeit] || ''} einstellen, „Sofort ausführen“</li>
      <li>Aktion „URL öffnen“ hinzufügen, Adresse dieser App eintragen: <code>${esc(location.href.split('#')[0])}</code></li><li>Fertig. Optional statt URL die Aktion „Mitteilung anzeigen“ wählen.</li></ol></div>
    <div class="karte"><b>⚙️ Einstellungen</b>
      <div class="zeile"><span>Neue Fragen pro Tag</span><div class="seg" id="neuPT">${[5, 10, 15, 20].map(n => `<button class="${Z.neuProTag === n ? 'an' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>
      <button class="btn zweit" id="interessen">Themen-Gewichtung & Einrichtung ändern</button>
      <button class="btn zweit" id="neuEinstufen">Einstufungstest wiederholen</button></div>
    <div class="karte"><b>💾 Sicherung</b><p class="leise">Deine Daten (Fortschritt, eigene Fragen, Anlagennotizen) liegen nur auf diesem iPhone. Ab und zu sichern (z. B. in iCloud Drive), damit nichts verloren geht.</p>
      <div class="reihe2"><button class="btn" id="export">Sichern</button><label class="btn zweit">Wiederherstellen<input type="file" id="import" accept=".json,application/json" hidden></label></div>
      <button class="btn gefahr" id="reset">Alles zurücksetzen</button></div>
    <p class="leise mitte">SCHALTZENTRALE · ${FRAGEN.length} Fragen im Katalog · Version 1.0</p>`;
  $('#eigeneNeu').onclick = eigeneFrage;
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { Z.eigene = Z.eigene.filter(q => q.id !== b.dataset.del); delete Z.karten[b.dataset.del]; speichern(); renderMehr(); });
  if ($('#mKopieren')) $('#mKopieren').onclick = () => {
    const txt = 'SCHALTZENTRALE – gemeldete Fragen:\n' + Z.meldungen.map(m => `- [${m.id}] ${m.frage}\n  → ${m.text}`).join('\n');
    navigator.clipboard?.writeText(txt).then(() => toast('Kopiert – einfach Claude schicken'), () => toast('Kopieren nicht möglich'));
  };
  if ($('#mLeeren')) $('#mLeeren').onclick = () => modal('<h3>Meldungen leeren?</h3><p class="leise">Erst leeren, wenn Claude sie korrigiert hat.</p>', () => { Z.meldungen = []; speichern(); renderMehr(); });
  document.querySelectorAll('#neuPT button').forEach(b => b.onclick = () => { Z.neuProTag = +b.dataset.v; speichern(); renderMehr(); });
  $('#interessen').onclick = () => { Z.setup.fertig = false; setupSchritt = 1; render(); };
  $('#neuEinstufen').onclick = () => { Z.einstufung.fertig = false; render(); };
  $('#export').onclick = exportieren;
  $('#import').onchange = importieren;
  $('#reset').onclick = () => modal('<h3>Wirklich alles löschen?</h3><p class="leise">Fortschritt, Streak, eigene Fragen und Anlagennotizen gehen verloren. Vorher sichern!</p>', () => { Z = leererZustand(); setupSchritt = 0; speichern(); render(); });
}

function eigeneFrage() {
  modal(`<h3>Eigene Frage</h3>
    <select id="eK">${KATEGORIEN.map(k => `<option value="${k.id}">${k.icon} ${k.name}</option>`).join('')}</select>
    <input id="eF" placeholder="Frage *"><input id="eA" placeholder="Richtige Antwort *">
    <input id="eX" placeholder="Falsche Antworten, mit ; getrennt (optional)">
    <textarea id="eE" rows="3" placeholder="Erklärung / Warum (optional)"></textarea><input id="eQ" placeholder="Quelle, z. B. Link (optional)">
    <small class="leise">Ohne falsche Antworten wird sie als Karteikarte abgefragt.</small>`, () => {
    const f = $('#eF').value.trim(), a = $('#eA').value.trim();
    if (!f || !a) { toast('Frage und Antwort ausfüllen'); return false; }
    const x = $('#eX').value.split(';').map(s => s.trim()).filter(Boolean);
    (Z.eigene ||= []).push({ id: 'e' + Date.now(), k: $('#eK').value, t: x.length ? 'mc' : 'karte', n: aktStufe($('#eK').value), f, a, x, tx: [a], e: $('#eE').value.trim(), q: $('#eQ').value.trim(), eigen: true });
    speichern(); toast('Gespeichert'); renderMehr();
  });
}

function exportieren() {
  const daten = Object.assign({}, Z, { exportiert: new Date().toISOString(), app: APP });
  const blob = new Blob([JSON.stringify(daten, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `schaltzentrale-sicherung-${heute()}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
function importieren(e) {
  const datei = e.target.files[0]; if (!datei) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== APP || !d.karten) throw new Error();
      delete d.exportiert; delete d.app;
      Z = Object.assign(leererZustand(), d); speichern(); toast('Wiederhergestellt'); render();
    } catch (err) { toast('Datei ist keine SCHALTZENTRALE-Sicherung'); }
  };
  r.readAsText(datei);
}

// ───────── Start ─────────
try { if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sitzung) render(); });
render();
