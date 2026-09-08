/**
 * Point d'entrée exécuté une fois au démarrage du serveur, avant la première
 * requête.
 *
 * Il ne fait qu'une chose : charger `src/env.ts`, dont le parsage Zod a lieu au
 * chargement du module. Une variable requise absente arrête donc le processus au
 * démarrage — pas à la première visite (AD-9).
 */
export async function register(): Promise<void> {
  // Le service tourne dans le runtime Node (AD-1) ; rien à faire ailleurs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const {ensureConfiguration} = await import('./lib/startup');
  await ensureConfiguration();
}
