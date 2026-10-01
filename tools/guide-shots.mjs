#!/usr/bin/env node
// Schermate della guida di CarveCAM. Con il server in esecuzione, avvia Chrome (o Edge) senza finestra, apre il
// progetto di esempio e cattura le schermate in italiano e in inglese in
// src/CarveCAM.Server/wwwroot/img/guide/<lingua>/<nome>.webp, con shots.json: dimensioni di ogni immagine e
// riquadri dei richiami numerati (in pixel dell'immagine), gli stessi numeri usati in wwwroot/js/guide-pages.js.
//
//   node tools/guide-shots.mjs [indirizzo del server, predefinito http://localhost:5080] [lingue, es. it,en]
//
// Rigenerarle quando l'interfaccia cambia in modo visibile. Usa le opzioni predefinite (tema scuro) e il
// magazzino utensili del server.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://localhost:5080').replace(/\/$/, '');
const LANGS = (process.argv[3] || 'it,en').split(',');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'CarveCAM.Server', 'wwwroot', 'img', 'guide');
const W = 1366, H = 820;
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Pagina del browser pilotata con il protocollo DevTools. */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Esegue codice nella pagina (await consentito) e ne restituisce il valore. */
  async run(code) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n--- ${code.slice(0, 200)}`);
    return r.result.value;
  }
  async size(w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
  }
  async capture(file, clip) {
    const params = { format: 'webp', quality: 84 };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await this.send('Page.captureScreenshot', params);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

async function launch() {
  const exe = BROWSERS.find(p => existsSync(p));
  if (!exe) throw new Error('Chrome o Edge non trovato');
  const profile = mkdtempSync(join(tmpdir(), 'carvecam-shots-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
    '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); } catch { /* non ancora pronto */ }
  }
  if (!target) throw new Error('il browser non risponde');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.size(W, H);
  const close = () => {
    try { ws.close(); } catch { /* già chiuso */ }
    proc.kill();
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* file ancora in uso */ } }, 1500);
  };
  return { page, close };
}

// funzioni di supporto definite nella pagina: riquadri degli elementi, attese, pulizia di notifiche e suggerimenti
const HELPERS = `
  window.__rect = el => { if (typeof el === 'string') el = document.querySelector(el); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v)); };
  window.__wait = ms => new Promise(r => setTimeout(r, ms));
  window.__clean = () => { document.getElementById('toast-root').replaceChildren(); document.getElementById('tooltip').hidden = true; };
  window.__union = rs => { rs = rs.filter(Boolean); const x = Math.min(...rs.map(r => r[0])), y = Math.min(...rs.map(r => r[1])); return [x, y, Math.max(...rs.map(r => r[0] + r[2])) - x, Math.max(...rs.map(r => r[1] + r[3])) - y]; };
  window.__inset = (r, f) => [Math.round(r[0] + r[2] * f), Math.round(r[1] + r[3] * f), Math.round(r[2] * (1 - 2 * f)), Math.round(r[3] * (1 - 2 * f))];
  window.__st = await import('/js/state.js');
  window.__THREE = await import('three');
`;

/** Riquadri relativi al ritaglio, interi. */
function relMarks(marks, clip) {
  const out = {};
  for (const [n, r] of Object.entries(marks || {})) {
    if (!r) continue;
    out[n] = [Math.round(r[0] - (clip?.x || 0)), Math.round(r[1] - (clip?.y || 0)), Math.round(r[2]), Math.round(r[3])];
  }
  return out;
}
const toClip = r => ({ x: Math.max(0, r[0]), y: Math.max(0, r[1]), width: r[2], height: r[3] });

async function shoot(lang, sampleMesh) {
  const dir = join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  const { page, close } = await launch();
  const info = {};
  const save = async (name, { clip, marks, w = W, h = H } = {}) => {
    const c = clip ? toClip(clip) : null;
    await page.run('window.__clean(); await window.__wait(250);');
    await page.capture(join(dir, `${name}.webp`), c);
    info[name] = { w: c ? c.width : w, h: c ? c.height : h, marks: relMarks(marks, c) };
    console.log(`  ${lang}/${name}.webp`);
  };
  try {
    // opzioni predefinite nella lingua voluta, senza schermata iniziale; mesh dell'esempio già sul server, se c'è
    await page.send('Page.navigate', { url: `${BASE}/` });
    await sleep(1500);
    await page.run(`localStorage.clear();
      localStorage.setItem('carvecam.settings.v1', JSON.stringify({ lang: '${lang}', startScreen: false }));
      ${sampleMesh ? `localStorage.setItem('carvecam.sample.mesh', ${JSON.stringify(JSON.stringify(sampleMesh))});` : ''}
      localStorage.setItem('carvecam.guide.seen', '1');`);
    await page.send('Page.reload');
    await sleep(1500);
    await page.run(`for (let i = 0; i < 200 && !(window.carvecam && document.getElementById('srv-status').dataset.state === 'ok' && !document.getElementById('splash')); i++) await new Promise(r => setTimeout(r, 100));`);
    await page.run(HELPERS);

    // progetto di esempio calcolato (la vista non disegna durante il calcolo: nel browser senza scheda video il
    // disegno continuo rallenterebbe il server sulla stessa macchina)
    await page.run(`carvecam.vp.paused = true;
      await carvecam.cmd.demoProject();
      carvecam.vp.paused = false;
      await __wait(600);`);
    const mesh = await page.run(`return JSON.parse(localStorage.getItem('carvecam.sample.mesh') || 'null');`);
    const ops = await page.run(`return carvecam.App.project.operations.map(o => o.id);`);
    const frame = `const B = (await import('/js/sample.js')).SAMPLE_BOUNDS;
      carvecam.vp.fit(new __THREE.Box3(new __THREE.Vector3(...B.min), new __THREE.Vector3(...B.max)));`;

    // 1. finestra completa
    await page.run(`__st.select({ type: 'operation', id: '${ops[0]}' }); carvecam.vp.viewFrom(new __THREE.Vector3(1, -1.25, 1.05), false); ${frame} await __wait(500);`);
    let m = await page.run(`const vp = __rect('#viewport');
      return { 1: __rect('#menubar'), 2: __rect('#toolbar'), 3: __rect('#tree-panel'), 4: __inset(vp, 0.3), 5: __rect('#view-tools'),
        6: __rect('#props-panel'), 7: __rect('#statusbar'), 8: __union([__rect('#cmd-search'), __rect('#srv-status')]) };`);
    await save('overview', { marks: m });

    // 2. barra strumenti con i gruppi
    m = await page.run(`const g = k => __rect('.tb-group[data-group="' + k + '"]');
      return { clip: __rect('#toolbar'), marks: { 1: g('project'), 2: g('model'), 3: g('planes'), 4: g('sketch'), 5: g('ops'), 6: g('output'), 7: g('view') } };`);
    await save('toolbar', m);

    // 3. proprietà della sgrossatura (finestra più alta per vedere più gruppi)
    await page.size(W, 1180);
    m = await page.run(`__st.select(null); await __wait(100); __st.select({ type: 'operation', id: '${ops[0]}' }); await __wait(400);
      document.getElementById('props').scrollTop = 0;
      const g = [...document.querySelectorAll('#props .p-group')];
      const p = __rect('#props-panel'), last = __rect(g[3]);
      return { clip: [p[0], p[1], p[2], last[1] + last[3] + 8 - p[1]], marks: { 1: __rect(g[0]), 2: __rect(g[1]), 3: __rect(g[2]), 4: last } };`);
    await save('operation', m);
    await page.size(W, H);

    // 4. simulazione a metà della sgrossatura
    m = await page.run(`carvecam.vp.viewFrom(new __THREE.Vector3(0.9, -1.3, 1.25), false); ${frame}
      await carvecam.cmd.simulate('${ops[0]}', 'rest');
      const s = carvecam.sim; s.playing = false; s.t = s.total * 0.09; s._apply(); await __wait(500);
      return { 1: __rect('#sim-bar'), 2: __rect('#sim-scope'), 3: __rect('#tcp-box') };`);
    await save('simulation', { marks: m });
    // immagine della schermata iniziale: solo il pezzo, i percorsi e la fresa (senza piano, origine, cubo e riquadri)
    m = await page.run(`const P = carvecam.App.project;
      P.planes[0].visible = false; P.origins[0].visible = false; __st.emit('project');
      for (const id of ['sim-bar', 'tcp-box', 'view-tools']) document.getElementById(id).style.visibility = 'hidden';
      window.__ov = [...carvecam.vp.overlays]; carvecam.vp.overlays.clear();
      carvecam.vp.viewFrom(new __THREE.Vector3(0.75, -1.25, 0.95), false);
      carvecam.vp.fit(new __THREE.Box3(new __THREE.Vector3(-60, -32, 0), new __THREE.Vector3(60, 32, 46))); await __wait(600);
      const v = __rect('#viewport');
      return { clip: [v[0] + v[2] * 0.08, v[1] + v[3] * 0.06, v[2] * 0.84, v[3] * 0.88] };`);
    await save('hero', m);
    await page.run(`const P = carvecam.App.project;
      P.planes[0].visible = true; P.origins[0].visible = true; __st.emit('project');
      for (const id of ['sim-bar', 'tcp-box', 'view-tools']) document.getElementById(id).style.visibility = '';
      for (const f of window.__ov) carvecam.vp.overlays.add(f);
      carvecam.sim.stop(); await __wait(200);`);

    // 5. sketch in modifica con il rettangolo della scritta selezionato (maniglie)
    m = await page.run(`const p = carvecam.App.project.planes[0], sk = p.sketches[0], e = sk.entities[1];
      carvecam.App.view.toolpaths = false; __st.emit('view');
      carvecam.cmd.editSketch(sk.id); await __wait(900);
      __st.select({ type: 'entity', id: e.id, sketchId: sk.id }); await __wait(500);
      const vr = carvecam.vp.el.getBoundingClientRect(), z = p.origin[2];
      const pts = [[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]].map(([x, y]) => carvecam.vp.toScreen(new __THREE.Vector3(x, y, z)));
      const xs = pts.map(q => q.x + vr.x), ys = pts.map(q => q.y + vr.y);
      const box = [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) - Math.min(...xs) + 20, Math.max(...ys) - Math.min(...ys) + 20];
      return { 1: __rect('#sketch-bar'), 2: box, 3: __rect('#sk-done') };`);
    await save('sketch', { marks: m });
    await page.run(`carvecam.cmd.finishSketch(); carvecam.App.view.toolpaths = true; __st.emit('view'); await __wait(400);`);

    // 6. esportazione del G-code
    m = await page.run(`__st.select(null); carvecam.cmd.exportGcode(); await __wait(600);
      const md = document.querySelector('#modal-root .modal'), rows = [...md.querySelectorAll('.form-row')].filter(r => !r.hidden);
      const labels = [...md.querySelectorAll('.modal-b > div > label')];
      return { clip: __rect(md), marks: { 1: __rect(rows[0]), 2: __rect(rows[1]), 3: __union(labels.map(__rect)) } };`);
    await save('export', m);
    await page.run(`document.querySelector('#modal-root .modal-f .btn').click(); await __wait(300);`);

    // 7. magazzino utensili con l'anteprima 3D di una fresa conica
    m = await page.run(`carvecam.cmd.toolLibrary(); await __wait(900);
      const row = [...document.querySelectorAll('.lib-list tbody tr')].find(r => /conica sferica/i.test(r.textContent));
      row?.click(); await __wait(1500);
      return { clip: __rect('#modal-root .modal') };`);
    await save('toollib', m);
    await page.run(`document.querySelector('#modal-root .modal-f .btn').click(); await __wait(300);`);

    writeFileSync(join(dir, 'shots.json'), `${JSON.stringify(info, null, 1)}\n`);
    return mesh;
  } finally {
    close();
  }
}

let mesh = null;
for (const lang of LANGS) {
  console.log(`Schermate (${lang}) da ${BASE}`);
  mesh = await shoot(lang, mesh);
}
console.log(`Fatto: ${OUT}`);
