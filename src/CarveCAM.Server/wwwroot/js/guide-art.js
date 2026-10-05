// Illustrazioni vettoriali della guida: schemi dei concetti CAM (asse utensile, terrazze e finitura, passi,
// ingressi, utensili, isole, zero pezzo, ostacoli, mouse). Colori dalle variabili del tema (classi ga-*),
// testi tradotti con L(it, en).

const svg = (w, h, body, label) =>
  `<svg class="g-art" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const text = (x, y, s, cls = 'ga-t', anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;
const arrowDefs = `<defs>
  <marker id="ga-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="ga-arrhead"/></marker>
  <marker id="ga-arr-n" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="ga-arrhead-n"/></marker>
  <marker id="ga-arr-p" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="ga-arrhead-p"/></marker>
  <pattern id="ga-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" class="ga-hatchline"/></pattern>
</defs>`;

/** Fresa verticale disegnata dalla punta (x, y) verso l'alto: tipo 'flat' | 'bull' | 'ball' | 'taper' | 'vbit'. */
function tool(x, y, type, r = 14, flute = 46, cls = 'ga-tool') {
  const sh = Math.max(5, r * 0.75), top = y - flute, sTop = top - 34;
  let body;
  if (type === 'taper') {
    const rt = r * 0.32;
    body = `M${x - rt} ${y - rt} A${rt} ${rt} 0 0 0 ${x + rt} ${y - rt} L${x + r} ${top} L${x - r} ${top} Z`;
  } else if (type === 'vbit') body = `M${x} ${y} L${x + r} ${y - r * 1.73} L${x + r} ${top} L${x - r} ${top} L${x - r} ${y - r * 1.73} Z`;
  else if (type === 'ball') body = `M${x - r} ${y - r} A${r} ${r} 0 0 0 ${x + r} ${y - r} L${x + r} ${top} L${x - r} ${top} Z`;
  else if (type === 'bull') { const c = r * 0.35; body = `M${x - r} ${y - c} Q${x - r} ${y} ${x - r + c} ${y} L${x + r - c} ${y} Q${x + r} ${y} ${x + r} ${y - c} L${x + r} ${top} L${x - r} ${top} Z`; }
  else body = `M${x - r} ${y} L${x + r} ${y} L${x + r} ${top} L${x - r} ${top} Z`;
  // eliche del tagliente
  let flutes = '';
  for (let k = 1; k < 4; k++) {
    const yy = top + (flute * k) / 4;
    flutes += `<path d="M${x - r * 0.9} ${yy + 5} L${x + r * 0.9} ${yy - 5}" class="ga-flute"/>`;
  }
  return `<g class="${cls}"><path d="${body}" class="ga-tool-cut"/>${type === 'taper' || type === 'vbit' ? '' : flutes}`
    + `<rect x="${x - sh}" y="${sTop}" width="${sh * 2}" height="${top - sTop}" class="ga-tool-shank"/></g>`;
}

export const ART = {
  /** Mouse: tasti e rotella. */
  mouse: L => svg(560, 210, `${arrowDefs}
    <g transform="translate(205 18)">
      <path d="M75 0C30 0 4 30 4 78v52c0 40 30 62 71 62s71-22 71-62V78C146 30 120 0 75 0z" class="ga-part"/>
      <path d="M75 0v70M4 70h142" class="ga-line"/>
      <path d="M8 66V78C8 34 30 6 72 4v62z" class="ga-hl-l"/>
      <path d="M142 66V78c0-44-22-72-64-74v62z" class="ga-hl-r"/>
      <rect x="66" y="16" width="18" height="36" rx="9" class="ga-hl-m"/>
    </g>
    <path d="M150 52 H226" class="ga-lead" marker-end="url(#ga-arr)"/>
    ${text(144, 46, L('Tasto sinistro', 'Left button'), 'ga-t ga-b', 'end')}
    ${text(144, 64, L('ruota la vista · seleziona', 'orbits the view · selects'), 'ga-t ga-s', 'end')}
    <path d="M410 52 H340" class="ga-lead" marker-end="url(#ga-arr)"/>
    ${text(416, 46, L('Tasto destro', 'Right button'), 'ga-t ga-b', 'start')}
    ${text(416, 64, L('sposta la vista (trasla)', 'pans the view'), 'ga-t ga-s', 'start')}
    <path d="M410 150 H296 V72" class="ga-lead" marker-end="url(#ga-arr)"/>
    ${text(416, 144, L('Rotella', 'Wheel'), 'ga-t ga-b', 'start')}
    ${text(416, 162, L('zoom verso il cursore', 'zooms towards the cursor'), 'ga-t ga-s', 'start')}
    ${text(416, 178, L('premuta: trasla', 'pressed: pans'), 'ga-t ga-s', 'start')}
    ${text(144, 140, L('Ctrl + clic', 'Ctrl + click'), 'ga-t ga-b', 'end')}
    ${text(144, 158, L('aggiunge o toglie', 'adds to or removes'), 'ga-t ga-s', 'end')}
    ${text(144, 174, L('dalla selezione', 'from the selection'), 'ga-t ga-s', 'end')}`,
  L('Comandi del mouse nella vista 3D', 'Mouse controls in the 3D view')),

  /** Piano di lavoro: la normale è l'asse utensile; a destra un piano inclinato (3+2). */
  planeAxis: L => svg(640, 270, `${arrowDefs}
    <g>
      <path d="M40 210 L150 245 L280 205 L170 172 Z" class="ga-part"/>
      <path d="M40 210 V182 L170 145 L280 177 V205" class="ga-part-side"/>
      <path d="M40 182 L150 217 L280 177" class="ga-line"/>
      <path d="M150 217 V245" class="ga-line"/>
      <path d="M100 150 Q150 100 205 152 Q150 175 100 150Z" class="ga-part-top"/>
      <path d="M30 120 L150 158 L295 112 L175 76 Z" class="ga-plane"/>
      ${tool(150, 126, 'ball', 9, 44, 'ga-tool ga-tool-ghost')}
      <path d="M232 106 V34" class="ga-normal" marker-end="url(#ga-arr-n)"/>
      <path d="M92 112 V64" class="ga-normal ga-normal-s" marker-end="url(#ga-arr-n)"/>
      ${text(244, 40, L('normale = asse utensile', 'normal = tool axis'), 'ga-t ga-b ga-c-n', 'start')}
      ${text(305, 118, L('piano di lavoro', 'work plane'), 'ga-t ga-c-p', 'start')}
      ${text(160, 266, L('la fresa lavora dal lato delle frecce', 'the tool works from the arrows side'), 'ga-t ga-s')}
    </g>
    <g transform="translate(360 0)">
      <path d="M40 220 L140 250 L250 214 L150 186 Z" class="ga-part"/>
      <path d="M40 220 V190 L150 156 L250 186 V214" class="ga-part-side"/>
      <path d="M40 190 L140 220 L250 186" class="ga-line"/>
      <path d="M140 220 V250" class="ga-line"/>
      <path d="M150 156 L250 186 L250 150 L170 128 Z" class="ga-part-top"/>
      <path d="M150 108 L262 140 L250 186 L138 152Z" class="ga-plane"/>
      <path d="M200 145 L245 70" class="ga-normal" marker-end="url(#ga-arr-n)"/>
      <g transform="rotate(31 202 142)">${tool(202, 142, 'bull', 10, 36, 'ga-tool ga-tool-ghost')}</g>
      ${text(140, 266, L('piano inclinato: lavorazione 3+2', 'tilted plane: 3+2 machining'), 'ga-t ga-s')}
    </g>`, L('Il piano di lavoro e la sua normale', 'The work plane and its normal')),

  /** Svuotatura a terrazze e finitura in proiezione (sezioni). */
  pocketFinish: L => {
    // superficie: una cupola sul fondo
    const surf = (x0) => `M${x0} 200 L${x0 + 60} 200 Q${x0 + 75} 200 ${x0 + 85} 175 Q${x0 + 125} 92 ${x0 + 165} 175 Q${x0 + 175} 200 ${x0 + 190} 200 L${x0 + 250} 200`;
    let terr = '';
    const lv = [72, 104, 136, 168];
    for (const y of lv) {
      // la terrazza si ferma prima della cupola (forma utensile + sovrametallo)
      const half = y < 100 ? 0 : y < 130 ? 26 : y < 150 ? 40 : 56;
      if (!half) terr += `<path d="M28 ${y} H272" class="ga-path"/>`;
      else terr += `<path d="M28 ${y} H${150 - half - 12}M${150 + half + 12} ${y} H272" class="ga-path"/>`;
    }
    let fin = '';
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = 340 + i * 4;
      let y;
      const rel = x - 340;
      if (rel < 70 || rel > 180) y = 192;
      else { const u = (rel - 125) / 55; y = 192 - 100 * Math.max(0, 1 - u * u) ** 1.3 + 4; }
      pts.push(`${x} ${y.toFixed(1)}`);
    }
    fin = `<path d="M${pts.join(' L')}" class="ga-path ga-path-fin"/>`;
    return svg(640, 250, `${arrowDefs}
      <rect x="20" y="40" width="260" height="160" class="ga-stock"/>
      <path d="${surf(25)}" class="ga-surf"/>
      ${terr}
      <path d="M286 72 V104" class="ga-dim" marker-start="url(#ga-arr-p)" marker-end="url(#ga-arr-p)"/>
      ${text(292, 92, L('passo verticale', 'stepdown'), 'ga-t ga-s', 'start')}
      ${tool(70, 136, 'bull', 12, 36)}
      ${text(150, 232, L('Svuotatura a terrazze: toglie il grosso', 'Terrace pocketing: removes the bulk'), 'ga-t ga-b')}
      <path d="${surf(335)}" class="ga-surf"/>
      ${fin}
      ${tool(465, 96, 'ball', 10, 34)}
      ${text(460, 232, L('Finitura in proiezione: segue la superficie', 'Projection finishing: follows the surface'), 'ga-t ga-b')}`,
    L('Svuotatura e finitura', 'Pocketing and finishing'));
  },

  /** Passo laterale, passo verticale e sovrametallo. */
  steps: L => {
    let passes = '';
    for (let i = 0; i < 5; i++) passes += `<circle cx="${90 + i * 46}" cy="120" r="22" class="ga-toolsec"/>`;
    return svg(640, 230, `${arrowDefs}
      <rect x="40" y="60" width="300" height="120" class="ga-stock"/>
      ${passes}
      <path d="M90 158 H136" class="ga-dim" marker-start="url(#ga-arr-p)" marker-end="url(#ga-arr-p)"/>
      ${text(113, 176, L('passo laterale', 'stepover'), 'ga-t ga-s')}
      ${text(190, 40, L('vista dall\'alto: passate affiancate', 'top view: side-by-side passes'), 'ga-t ga-b')}
      <g transform="translate(380 0)">
        <path d="M20 60 H230 V190 H20 Z" class="ga-stock"/>
        <path d="M20 92 H107 M20 124 H117 M20 156 H125" class="ga-path"/>
        <path d="M190 190 Q150 190 140 150 Q128 100 110 60" class="ga-surf"/>
        <path d="M172 190 Q133 190 124 150 Q113 104 96 60" class="ga-offset"/>
        <path d="M222 92 V124" class="ga-dim" marker-start="url(#ga-arr-p)" marker-end="url(#ga-arr-p)"/>
        ${text(216, 112, L('passo vert.', 'stepdown'), 'ga-t ga-s', 'end')}
        ${text(125, 40, L('sezione: terrazze e sovrametallo', 'section: terraces and stock'), 'ga-t ga-b')}
        ${text(125, 212, L('tratteggio: sovrametallo lasciato sul modello', 'dashed: stock left on the model'), 'ga-t ga-s')}
      </g>`, L('Passi e sovrametallo', 'Steps and stock allowance'));
  },

  /** Ingressi nel materiale: affondo, rampa, elica. */
  entries: L => {
    let helix = 'M500 50';
    for (let a = 0; a <= 360 * 3; a += 15) {
      const r = a * Math.PI / 180;
      helix += ` L${(500 + 46 * Math.cos(r)).toFixed(1)} ${(50 + a / 9 + 14 * Math.sin(r)).toFixed(1)}`;
    }
    return svg(640, 220, `${arrowDefs}
      <path d="M40 170 H200" class="ga-floor"/>
      <path d="M120 40 V170" class="ga-plunge" marker-end="url(#ga-arr)"/>
      ${text(120, 200, L('Affondo verticale', 'Vertical plunge'), 'ga-t ga-b')}
      <path d="M240 170 H400" class="ga-floor"/>
      <path d="M250 50 L390 82 L250 114 L390 146 L320 162" class="ga-ramp" marker-end="url(#ga-arr)"/>
      ${text(320, 200, L('Rampa lungo il percorso', 'Ramp along the path'), 'ga-t ga-b')}
      <path d="M430 170 H590" class="ga-floor"/>
      <path d="${helix}" class="ga-ramp"/>
      ${text(510, 200, L('Elica', 'Helix'), 'ga-t ga-b')}`,
    L('Ingressi nel materiale', 'Entry moves'));
  },

  /** Tipi di fresa. */
  tools: L => {
    const types = [['flat', L('Cilindrica', 'Flat')], ['bull', L('Torica', 'Bull nose')], ['ball', L('Sferica', 'Ball')],
      ['taper', L('Conica sferica', 'Tapered ball')], ['vbit', L('A V', 'V-bit')]];
    return svg(640, 220, types.map(([k, lbl], i) => {
      const x = 70 + i * 125;
      return `${tool(x, 160, k, k === 'taper' ? 15 : 16, 64)}${text(x, 195, lbl, 'ga-t ga-b')}`;
    }).join(''), L('Tipi di fresa', 'Cutter types'));
  },

  /** Contorni e isole (regola pari/dispari). */
  island: L => svg(640, 220, `${arrowDefs}
    <path d="M60 40 H300 V180 H60 Z M150 110 m-36 0 a36 36 0 1 0 72 0 a36 36 0 1 0 -72 0" class="ga-region" fill-rule="evenodd"/>
    <path d="M60 40 H300 V180 H60 Z" class="ga-sketch"/>
    <circle cx="150" cy="110" r="36" class="ga-sketch"/>
    ${text(180, 205, L('Contorno con un cerchio dentro: il cerchio è un\'isola', 'Outline with a circle inside: the circle is an island'), 'ga-t ga-s')}
    <g transform="translate(340 0)">
      <path d="M40 40 H260 V180 H40 Z" class="ga-sketch"/>
      <path d="M150 50 H250 V170 H150 Z" class="ga-region"/>
      <path d="M150 50 H250 V170 H150 Z" class="ga-sketch-sel"/>
      ${text(150, 205, L('Con alcune entità selezionate si lavora solo lì', 'With some entities selected only those are machined'), 'ga-t ga-s')}
    </g>`, L('Contorni, isole ed entità selezionate', 'Outlines, islands and selected entities')),

  /** Zero pezzo su uno spigolo del grezzo. */
  origin: L => svg(640, 230, `${arrowDefs}
    <path d="M150 140 L320 184 L480 140 L310 100 Z" class="ga-part-top"/>
    <path d="M150 140 V164 L320 208 L480 164 V140" class="ga-part-side"/>
    <path d="M320 184 V208" class="ga-line"/>
    <path d="M184 140 L320 175 L446 140 L310 109 Z" class="ga-recess"/>
    <path d="M150 140 L238 163" class="ga-ax-x" marker-end="url(#ga-arr)"/>
    <path d="M150 140 L222 123" class="ga-ax-y" marker-end="url(#ga-arr)"/>
    <path d="M150 140 V60" class="ga-ax-z" marker-end="url(#ga-arr)"/>
    <circle cx="150" cy="140" r="6" class="ga-origin"/>
    ${text(242, 178, 'X', 'ga-t ga-b ga-c-x', 'start')}
    ${text(226, 120, 'Y', 'ga-t ga-b ga-c-y', 'start')}
    ${text(158, 58, 'Z', 'ga-t ga-b ga-c-z', 'start')}
    ${text(138, 136, L('zero pezzo', 'work zero'), 'ga-t ga-b', 'end')}
    ${text(138, 152, 'X0 Y0 Z0', 'ga-t ga-s', 'end')}
    ${text(520, 52, L('Le coordinate del G-code partono', 'G-code coordinates start'), 'ga-t ga-s')}
    ${text(520, 68, L('dall\'origine scelta: azzera la macchina', 'from the chosen origin: zero the machine'), 'ga-t ga-s')}
    ${text(520, 84, L('sullo stesso punto del pezzo', 'on the same point of the part'), 'ga-t ga-s')}`,
  L('Zero pezzo', 'Work zero')),

  /** Ostacoli: la fresa gira attorno agli oggetti con il sovrametallo. */
  obstacles: L => svg(640, 200, `${arrowDefs}
    <path d="M40 160 H600" class="ga-floor"/>
    <rect x="250" y="70" width="140" height="90" rx="6" class="ga-part-top"/>
    <path d="M238 160 V64 Q238 58 244 58 H396 Q402 58 402 64 V160" class="ga-offset"/>
    <path d="M60 130 H208 M432 130 H580" class="ga-path"/>
    ${tool(222, 130, 'bull', 13, 40)}
    ${text(320, 120, L('ostacolo', 'obstacle'), 'ga-t ga-b')}
    ${text(320, 46, L('sovrametallo', 'stock allowance'), 'ga-t ga-s')}
    ${text(320, 190, L('Oggetti e artefatti spuntati come ostacoli non vengono mai toccati dalla fresa', 'Objects and primitives checked as obstacles are never touched by the cutter'), 'ga-t ga-s')}`,
  L('Ostacoli', 'Obstacles')),
};
