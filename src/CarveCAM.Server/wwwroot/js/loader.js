// Caricamento animato con il logo: la fresa (punto ambra) scava la passata interna e poi la "C" esterna.
// La schermata di avvio è nell'HTML (compare prima dei moduli); l'indicatore delle attività ne usa una copia.

/** Copia l'animazione della schermata di avvio nell'indicatore delle attività (calcoli, aperture, importazioni). */
export function initLoaders() {
  const src = document.querySelector('#splash .cc-loader');
  const slot = document.querySelector('#busy .busy-logo');
  if (!src || !slot || slot.firstChild) return;
  const svg = src.cloneNode(true);
  // il gradiente ha bisogno di un identificativo proprio: la schermata di avvio verrà rimossa
  svg.querySelector('linearGradient').id = 'ccl-bg-busy';
  svg.querySelector('.ccl-tile').setAttribute('fill', 'url(#ccl-bg-busy)');
  slot.append(svg);
}

/** Fase in corso mostrata sotto il logo della schermata di avvio. */
export function splashText(text) {
  const el = document.getElementById('splash-text');
  if (el) el.textContent = text;
}

/** Interfaccia pronta: la schermata di avvio sfuma e viene rimossa. */
export function splashDone() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('out')) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 450);
}
