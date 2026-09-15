/**
 * Point d'entrée exécuté une fois au démarrage du serveur, avant la première
 * requête.
 *
 * Trois contrôles, dans cet ordre :
 *  1. la configuration — le parsage Zod de `src/env.ts` a lieu au chargement du
 *     module, donc une variable requise absente arrête le processus ici (AD-9) ;
 *  2. le contenu privé — `CONTENT_DIR` est lu, validé et gelé une fois pour
 *     toutes ; un contenu invalide arrête le processus plutôt que de servir une
 *     page dégradée (AD-2) ;
 *  3. le journal — `DATA_DIR/usage.db` est ouvert et son schéma posé ; un
 *     répertoire inexistant ou non inscriptible arrête le processus plutôt que
 *     de laisser la première visite échouer sans témoin (AD-7).
 *
 * L'ordre n'est pas négociable : sans `CONTENT_DIR` ni `DATA_DIR` validés, il
 * n'y a rien à lire ni à ouvrir ; et un contrôle qui échoue arrête tout, les
 * suivants ne s'exécutent pas.
 */
export async function register(): Promise<void> {
  // Le service tourne dans le runtime Node (AD-1) ; rien à faire ailleurs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const {ensureConfiguration, ensureContentLoaded, ensureJournalOpen} = await import(
    './lib/startup'
  );
  if ((await ensureConfiguration()) && (await ensureContentLoaded())) {
    await ensureJournalOpen();
  }
}
