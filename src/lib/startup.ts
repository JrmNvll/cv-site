import {writeSync} from 'node:fs';

/**
 * Contrôle de configuration au démarrage — appelé par `src/instrumentation.ts`,
 * uniquement dans le runtime Node.
 *
 * Next journalise l'échec d'un hook d'instrumentation mais laisse le processus
 * vivant : un service NSSM le croirait en bonne santé alors qu'il ne sert rien.
 * Ici, une configuration invalide arrête le processus avec un code de sortie non
 * nul — mieux vaut ne rien servir qu'une version dégradée (AD-2, AD-9).
 */
export async function ensureConfiguration(): Promise<void> {
  try {
    await import('../env');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Écriture **synchrone** sur stderr : sur un flux redirigé (service NSSM),
    // `console.error` peut être tronqué par la sortie du processus, et
    // l'exploitant verrait un service mort sans en connaître la cause.
    writeSync(2, `${message}\n`);
    process.exitCode = 1;
    // Sortie propre : reprend le code déjà posé, sans le forcer une seconde fois.
    process.exit();
  }
}
