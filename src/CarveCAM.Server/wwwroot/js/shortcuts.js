// Scorciatoie da tastiera e del mouse: finestra Aiuto › Scorciatoie e capitolo della guida.
import { t } from './i18n.js';

/** Righe [tasti, descrizione], già tradotte. */
export function shortcutRows() {
  return [
    ['F1', t('Guida di CarveCAM')], ['Ctrl+K', t('Cerca un comando')],
    ['Ctrl+S / Ctrl+O', t('Salva / apri progetto (.ccam)')], ['Ctrl+Shift+S', t('Salva con nome')], ['Ctrl+I', t('Importa modello 3D')],
    ['Ctrl+Z / Ctrl+Y', t('Annulla / ripeti')], ['Canc', t('Elimina selezione')], ['Ctrl+D', t('Duplica')],
    [t('Ctrl+clic'), t('Aggiunge o toglie dalla selezione (navigatore, vista, entità dello sketch)')], ['Ctrl+L', t('Blocca / sblocca la selezione')],
    ['G / R', t('Manipolatore: sposta / ruota')], [t('Clic sul centro'), t('Manipolatore: scegli un nuovo punto di riferimento')],
    ['Shift+M / Shift+R / Shift+C', t('Sposta / ruota / copia la selezione')], ['Shift+S', t('Scala smart: riferimento e misura finale')],
    ['Shift+A / Shift+P', t('Serie rettangolare / polare')],
    [t('Comandi di modifica: Invio / Backspace'), t('Applica / torna al passo precedente (Maiusc: lungo un asse, angoli a 15°)')],
    ['Esc', t('Annulla comando / deseleziona / esci dallo sketch')],
    ['F', t('Adatta alla vista')], ['7 / 1 / 3 / 0', t('Vista alto / fronte / destra / iso')], ['5', t('Prospettica ↔ ortogonale')],
    ['F9', t('Calcola lavorazione selezionata (o tutte)')], [t('Spazio'), t('Avvia/pausa simulazione')],
    [t('Sketch: L R C P S'), t('Polilinea, rettangolo, cerchio, poligono, seleziona')],
    [t('Sketch: Invio / Backspace'), t('Chiudi polilinea / annulla ultimo vertice')],
    [t('Mouse'), t('Sinistro ruota · centrale/destro trasla · rotella zoom')],
    [t('Tasto destro (clic)'), t('Menu dell\'elemento sotto il cursore (vista e navigatore)')],
  ];
}
