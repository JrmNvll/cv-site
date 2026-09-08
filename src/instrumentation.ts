/**
 * Point d'entrée exécuté une fois au démarrage du serveur, avant la première
 * requête.
 *
 * Deux contrôles, dans cet ordre :
 *  1. la configuration — le parsage Zod de `src/env.ts` a lieu au chargement du
 *     module, donc une variable requise absente arrête le processus ici (AD-9) ;
 *  2. le contenu privé — `CONTENT_DIR` est lu, validé et gelé une fois pour
 *     toutes ; un contenu invalide arrête le processus plutôt que de servir une
 *     page dégradée (AD-2).
 *
 * L'ordre n'est pas négociable : sans `CONTENT_DIR` validé, il n'y a rien à lire.
 */
export async function register(): Promise<void> {
  // Le service tourne dans le runtime Node (AD-1) ; rien à faire ailleurs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const {ensureConfiguration, ensureContentLoaded} = await import('./lib/startup');
  if (await ensureConfiguration()) {
    await ensureContentLoaded();
  }
}
