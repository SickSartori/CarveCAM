// Modalità demo (la prova online in Codespaces): il server la segnala in /api/version (impostazione Demo:Enabled).
// Il programma si apre sul progetto di esempio e restano spenti apertura, importazione e salvataggio di progetti.
// È un limite dell'interfaccia, non una protezione: serve a far provare l'esempio, non a isolare un servizio pubblico.
import { t } from './i18n.js';

/** Letto prima che parta il resto dell'interfaccia (top-level await): gli altri moduli lo trovano già pronto. */
export const DEMO = await fetch('/api/version', { cache: 'no-store' })
  .then(r => r.json()).then(j => !!j.demo).catch(() => false);

/** Azioni spente nella demo: progetto nuovo, apri, importa, salva, copie di sicurezza, schermata iniziale, archivi, diagnostica. */
export const DEMO_OFF = new Set([
  'file.new', 'file.open', 'file.save', 'file.saveAs', 'file.rename', 'file.import', 'file.recovery', 'file.home',
  'tools.libExport', 'tools.libImport', 'help.log', 'help.blackbox', 'help.updates',
]);

export const demoWhy = () => t('Non disponibile nella demo online: installa CarveCAM per usare i tuoi modelli');
