/**
 * Un signal d'abandon à échéance, pour les appels `fetch` du navigateur.
 *
 * `AbortSignal.timeout()` est récent (Safari 16, Chrome 103) : sur un
 * navigateur qui ne l'a pas, l'appel lèverait un `TypeError` synchrone que
 * le `catch` de l'appelant avalerait — chaque clic afficherait « indisponible »
 * sans qu'aucune requête ne parte. Le repli fait la même chose avec un
 * `AbortController` et un minuteur.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')), ms);
  return controller.signal;
}
