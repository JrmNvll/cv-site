import {writeSync} from 'node:fs';

/**
 * Contrôles de démarrage — appelés par `src/instrumentation.ts`, uniquement dans
 * le runtime Node.
 *
 * Trois choses doivent être vraies avant la première requête : la configuration
 * est complète (AD-9), le contenu de `CONTENT_DIR` est lisible et valide
 * (AD-2), et le journal de `DATA_DIR` s'ouvre (AD-7). Les trois échouent de la
 * même façon : le message sur stderr, un code de sortie non nul, aucun serveur
 * qui reste debout à moitié.
 *
 * Next journalise l'échec d'un hook d'instrumentation mais laisse le processus
 * vivant : un service NSSM le croirait en bonne santé alors qu'il ne sert rien.
 * Ici, le processus s'arrête — mieux vaut ne rien servir qu'une version
 * dégradée.
 */
export async function ensureConfiguration(): Promise<boolean> {
  return guard(async () => {
    await import('../env');
  });
}

/**
 * Charge, valide et gèle le contenu privé. L'ordre compte : sans `CONTENT_DIR`
 * validé, il n'y a rien à charger — `ensureConfiguration()` passe d'abord.
 */
export async function ensureContentLoaded(): Promise<boolean> {
  return guard(async () => {
    const {ensureContent} = await import('../content');
    ensureContent();
  });
}

/**
 * Ouvre `DATA_DIR/usage.db` et pose son schéma. Un répertoire inexistant ou non
 * inscriptible se voit ici, au démarrage — pas à la première visite, qui
 * échouerait sans que personne ne regarde. Après le contenu : la configuration
 * est déjà validée, et un contenu invalide a déjà arrêté le processus.
 */
export async function ensureJournalOpen(): Promise<boolean> {
  return guard(async () => {
    const {ensureJournal} = await import('../journal');
    ensureJournal();
  });
}

/**
 * Même échec, même message, même sortie, quel que soit le contrôle.
 * Rend `false` si le processus aurait dû s'arrêter — utile aux tests, qui
 * neutralisent `process.exit`, et inatteignable en production.
 */
async function guard(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Écriture **synchrone** sur stderr : sur un flux redirigé (service NSSM),
    // `console.error` peut être tronqué par la sortie du processus, et
    // l'exploitant verrait un service mort sans en connaître la cause.
    writeSync(2, `${message}\n`);
    process.exitCode = 1;
    // Sortie propre : reprend le code déjà posé, sans le forcer une seconde fois.
    process.exit();
    return false;
  }
}
