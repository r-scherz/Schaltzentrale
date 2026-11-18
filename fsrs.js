// FSRS (Free Spaced Repetition Scheduler), Version 4.5, mit Standard-Gewichten.
// Note: 1 = Nochmal (falsch/geraten), 2 = Schwer, 3 = Gut, 4 = Leicht
const FSRS = (() => {
  const w = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
  const DECAY = -0.5, FACTOR = 19 / 81, ZIEL = 0.9, MAX_TAGE = 365, TAG = 86400000;
  const clampD = d => Math.min(10, Math.max(1, d));
  const d0 = g => clampD(w[4] - (g - 3) * w[5]);
  const abruf = (tage, s) => Math.pow(1 + FACTOR * tage / s, DECAY);
  const intervall = s => Math.min(MAX_TAGE, Math.max(1, Math.round(s / FACTOR * (Math.pow(ZIEL, 1 / DECAY) - 1))));

  // karte: { s, d, reps, lapses, due, last } – liefert neue Werte zurück
  function bewerten(karte, g, jetzt = Date.now()) {
    const k = Object.assign({ s: 0, d: 0, reps: 0, lapses: 0 }, karte);
    if (!k.last) {
      k.s = w[g - 1];
      k.d = d0(g);
    } else {
      const tage = Math.max(0, (jetzt - k.last) / TAG);
      const r = abruf(tage, k.s);
      const dNeu = k.d - w[6] * (g - 3);
      k.d = clampD(w[7] * d0(3) + (1 - w[7]) * dNeu);
      if (g === 1) {
        k.s = Math.min(k.s, w[11] * Math.pow(k.d, -w[12]) * (Math.pow(k.s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)));
      } else {
        const hart = g === 2 ? w[15] : 1, leicht = g === 4 ? w[16] : 1;
        k.s = k.s * (Math.exp(w[8]) * (11 - k.d) * Math.pow(k.s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hart * leicht + 1);
      }
    }
    k.s = Math.max(0.1, k.s);
    k.last = jetzt;
    if (g === 1) {
      k.lapses += k.reps > 0 ? 1 : 0;
      k.due = jetzt + 10 * 60000; // in 10 Minuten wieder
    } else {
      k.reps += 1;
      k.due = jetzt + intervall(k.s) * TAG;
    }
    return k;
  }

  const abrufJetzt = (karte, jetzt = Date.now()) =>
    karte && karte.last ? abruf(Math.max(0, (jetzt - karte.last) / TAG), karte.s) : 0;

  return { bewerten, abrufJetzt, intervall };
})();
