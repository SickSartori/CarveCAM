// Vetrina animata della schermata iniziale: una fresa scava la "C" del logo con passate concentriche (come una
// svuotatura), sul piano della macchina visto in prospettiva, con la riga di G-code corrente e l'avanzamento.
// Ciclo: affondo, passate, risalita, pezzo finito, dissolvenza. Con "riduci movimento" mostra il pezzo finito.
import { h } from './dialogs.js';
import { t } from './i18n.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// palco 400 x 300 (unità = px del palco), lastra 300 x 210 al centro; scala 2 unità = 1 mm nella riga di G-code
const W = 400, H = 300, CX = 200, CY = 150;
const R_OUT = 76, R_IN = 32, TOOL_R = 7, STEP = 11;
const TOOL_D_MM = (2 * TOOL_R) / 2;
const Z_SAFE = 46;      // quota di sicurezza (px sul palco)
const THICK = 12;       // spessore della lastra: la superficie è a questa quota sopra il piano della macchina
const T = { plunge: 700, cut: 8600, lift: 600, hold: 1900, fade: 700 };
const CYCLE = T.plunge + T.cut + T.lift + T.hold + T.fade;

/**
 * Percorso: archi di 270° (apertura a destra, come nel logo) dall'esterno all'interno, a zigzag, poi una passata
 * di contorno che pulisce le due pareti diritte alle estremità della C. ends: lunghezza alla fine di ogni passata.
 */
function toolpath() {
  const radii = [];
  for (let r = R_OUT; r >= R_IN - 0.01; r -= STEP) radii.push(r);
  const a = Math.PI / 4;
  const P = (r, s) => `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + s * r * Math.sin(a)).toFixed(2)}`;
  // arco da un'estremità (s = -1 in alto, +1 in basso a destra) all'altra passando a sinistra
  const arc = (r, s0) => `A${r} ${r} 0 1 ${s0 < 0 ? 0 : 1} ${P(r, -s0)}`;
  let d = '';
  const ends = [];
  let s0 = -1;
  radii.forEach((r, k) => {
    d += `${k ? 'L' : 'M'}${P(r, s0)}${arc(r, s0)}`;
    ends.push((k ? ends[k - 1] + STEP : 0) + 1.5 * Math.PI * r);
    s0 = -s0;
  });
  // contorno: parete diritta all'estremità dove è finita l'ultima passata, arco esterno, parete opposta
  const rIn = radii[radii.length - 1], wall = R_OUT - rIn;
  d += `L${P(R_OUT, s0)}${arc(R_OUT, s0)}L${P(rIn, -s0)}`;
  ends.push(ends[ends.length - 1] + 2 * wall + 1.5 * Math.PI * R_OUT);
  return { d, ends, passes: radii.length };
}

const ease = x => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp01 = x => Math.max(0, Math.min(1, x));
const mm = v => (v >= 0 ? ' ' : '') + v.toFixed(3);

/** Crea la vetrina; onOpen: clic (apre il progetto di esempio). */
export function carveShowcase({ title, text, cta, onOpen }) {
  const { d, ends, passes } = toolpath();

  // ---- piano della macchina, lastra con spessore, solco, percorso, trucioli (tutto sul palco inclinato)
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'hs-svg' });
  const defs = svg('defs');
  const glow = svg('radialGradient', { id: 'hs-glow' });
  glow.append(svg('stop', { offset: '0', 'stop-color': '#ffb547', 'stop-opacity': '.85' }), svg('stop', { offset: '1', 'stop-color': '#ffb547', 'stop-opacity': '0' }));
  const done = svg('linearGradient', { id: 'hs-done', x1: '0', y1: '0', x2: '1', y2: '1' });
  done.append(svg('stop', { offset: '0', 'stop-color': '#4f6bff' }), svg('stop', { offset: '1', 'stop-color': '#12b5d6' }));
  defs.append(glow, done);
  const plan = svg('path', { d, class: 'hs-plan' });           // percorso ancora da fare (anteprima)
  const rim = svg('path', { d, class: 'hs-rim' });             // parete del solco
  const floor = svg('path', { d, class: 'hs-floor' });         // fondo del solco
  const finish = svg('path', { d, class: 'hs-finish' });       // pezzo finito: il solco si colora come il logo
  const line = svg('path', { d, class: 'hs-line' });           // percorso eseguito
  const spark = svg('circle', { r: 26, fill: 'url(#hs-glow)', class: 'hs-spark' });
  const chipsG = svg('g', { class: 'hs-chips' });
  const groove = svg('g', { class: 'hs-groove' });
  groove.append(rim, floor, finish, line);
  g.append(defs, plan, groove, spark, chipsG);
  // lunghezze calcolate in toolpath(): il tracciato non è ancora nella pagina
  const L = ends[ends.length - 1];
  for (const p of [rim, floor, finish, line]) p.style.strokeDasharray = `${L} ${L + 40}`;

  const chips = Array.from({ length: 14 }, () => {
    const c = svg('circle', { r: '1.6', class: 'hs-chip' });
    chipsG.append(c);
    return { c, life: 0, x: 0, y: 0, vx: 0, vy: 0 };
  });

  // fresa: un pannello verticale (tagliente, gambo, pinza) sempre rivolto verso chi guarda
  const cutter = h('div', { class: 'hs-cutter', 'aria-hidden': 'true' },
    h('div', { class: 'hs-tool' }, h('div', { class: 'hs-collet' }), h('div', { class: 'hs-shank' }), h('div', { class: 'hs-flute' })),
    h('div', { class: 'hs-shadow' }));

  const plate = h('div', { class: 'hs-plate' });
  const sides = [0, 1, 2, 3, 4, 5].map(i => h('div', { class: 'hs-side', style: `--z:${(i * THICK) / 6}px` }));
  const stage = h('div', { class: 'hs-stage' }, h('div', { class: 'hs-bed' }), h('div', { class: 'hs-drop' }), ...sides, plate, g, cutter);
  const scaler = h('div', { class: 'hs-scale' }, stage);

  // ---- riga di G-code, stato, avanzamento, testo
  const code = h('span', { class: 'hs-code' });
  const pass = h('span', { class: 'hs-pass' });
  const pct = h('span', { class: 'hs-pct' });
  const bar = h('span', { class: 'hs-bar-in' });
  const el = h('button', { class: 'home-show', type: 'button', onclick: onOpen, 'aria-label': `${title}: ${cta}` },
    h('div', { class: 'hs-view', 'aria-hidden': 'true' }, scaler),
    h('div', { class: 'hs-hud', 'aria-hidden': 'true' },
      h('span', { class: 'hs-live' }, h('i'), t('Simulazione')), code),
    h('div', { class: 'hs-cap' },
      h('div', { class: 'hs-prog', 'aria-hidden': 'true' },
        h('span', {}, t('Svuotatura concentrica · fresa Ø{d} mm', { d: TOOL_D_MM })), pass, pct),
      h('span', { class: 'hs-bar', 'aria-hidden': 'true' }, bar),
      h('span', { class: 'hs-row' },
        h('span', { class: 'hs-title' }, h('b', {}, title), h('span', { class: 'hs-txt' }, text)),
        h('span', { class: 'home-resume-go' }, `${cta} ›`))));

  // ---- stato a un istante del ciclo
  let raf = 0, t0 = 0, last = 0, spin = 0, lastCode = 0, nLine = 0;
  let P0 = null, P1 = null;

  function render(ms, dt) {
    P0 ??= line.getPointAtLength(0);
    P1 ??= line.getPointAtLength(L);
    let x, y, z, cut, feed = true, show = 1, finished = false;
    if (ms < T.plunge) {                                   // affondo
      const k = ease(ms / T.plunge);
      ({ x, y } = P0); z = Z_SAFE * (1 - k); cut = 0; feed = k > 0.6;
    } else if (ms < T.plunge + T.cut) {                    // passate
      cut = L * ((ms - T.plunge) / T.cut);
      ({ x, y } = line.getPointAtLength(cut)); z = 0;
    } else if (ms < T.plunge + T.cut + T.lift) {           // risalita
      const k = ease((ms - T.plunge - T.cut) / T.lift);
      ({ x, y } = P1); z = Z_SAFE * k; cut = L; feed = false;
    } else {                                               // pezzo finito, poi dissolvenza e ritorno all'inizio
      const k = clamp01((ms - T.plunge - T.cut - T.lift - T.hold) / T.fade);
      const e = ease(k);
      x = P1.x + (P0.x - P1.x) * e; y = P1.y + (P0.y - P1.y) * e; z = Z_SAFE;
      cut = L; feed = false; finished = true; show = 1 - k;
    }
    const off = `${L - cut}`;
    for (const p of [rim, floor, finish, line]) p.style.strokeDashoffset = off;
    groove.style.opacity = String(show);
    el.classList.toggle('is-done', finished && show > 0.5);
    const cutting = z < 0.5 && cut > 0 && cut < L;
    spark.setAttribute('cx', x.toFixed(2)); spark.setAttribute('cy', y.toFixed(2));
    spark.style.opacity = cutting ? '1' : '0';
    spin = (spin + dt * 2.2) % 40;
    cutter.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${(THICK + z).toFixed(2)}px)`;
    cutter.style.setProperty('--spin', `${spin.toFixed(1)}px`);
    cutter.style.setProperty('--lift', `${z.toFixed(2)}px`);
    cutter.style.setProperty('--sh', (1 - z / Z_SAFE).toFixed(3));

    // trucioli
    for (const c of chips) {
      if (c.life > 0) {
        c.life -= dt; c.x += c.vx * dt; c.y += c.vy * dt;
        c.c.setAttribute('cx', c.x.toFixed(1)); c.c.setAttribute('cy', c.y.toFixed(1));
        c.c.style.opacity = String(Math.max(0, c.life / 420));
      } else c.c.style.opacity = '0';
    }
    if (cutting && Math.random() < dt / 45) {
      const c = chips.find(q => q.life <= 0);
      if (c) {
        const a = Math.random() * Math.PI * 2, v = 0.03 + Math.random() * 0.05;
        Object.assign(c, { life: 420, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
      }
    }

    // riga di G-code e avanzamento (aggiornati a scatti, come un controllo numerico)
    if (ms - lastCode > 90 || ms < lastCode) {
      lastCode = ms;
      const X = (x - CX) / 2, Y = -(y - CY) / 2, Z = cutting || (cut > 0 && z < 0.5) ? -1.5 : z / 2 - 1.5;
      nLine = Math.floor(cut / 3) + (z > 0 && cut >= L ? 12 : 0);
      code.textContent = `N${String(10 + nLine * 2).padStart(4, '0')} ${feed ? 'G1' : 'G0'} X${mm(X)} Y${mm(Y)} Z${mm(Z)}${feed ? ' F1200' : ''}`;
      const k = ends.findIndex(e => cut <= e + 0.01);
      pass.textContent = k >= passes || k < 0 ? t('contorno') : t('passata {k}/{n}', { k: k + 1, n: passes });
      const p = Math.round((cut / L) * 100);
      pct.textContent = `${p}%`;
      bar.style.width = `${p}%`;
    }
  }

  const frame = now => {
    if (!t0) t0 = now;
    const dt = Math.min(64, last ? now - last : 16);
    last = now;
    render((now - t0) % CYCLE, dt);
    raf = requestAnimationFrame(frame);
  };

  // il palco (400 x 300) si adatta alla larghezza della vetrina
  const ro = new ResizeObserver(() => scaler.style.setProperty('--k', (el.clientWidth / 500).toFixed(3)));
  ro.observe(el);

  const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return {
    el,
    start() {
      if (raf) return;
      if (reduce()) { render(T.plunge + T.cut + T.lift + 10, 16); return; }
      t0 = 0; last = 0;
      render(0, 16);   // primo fotogramma subito: la fresa non compare nell'angolo del palco
      raf = requestAnimationFrame(frame);
    },
    stop() { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); },
  };
}
