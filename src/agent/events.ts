/**
 * Ce que l'agent émet pendant un appel, et la file qui porte ces événements
 * du producteur (la passerelle) au consommateur (la route, qui les met en SSE).
 *
 * Les trois événements sont ceux d'AD-16 : `delta` porte du texte sans bloc
 * `<sources>` ; `done` clôt avec les sources valides et l'identifiant de
 * l'échange ; `error` clôt après une exception du SDK ou du réseau — après
 * des `delta` s'il y en a eu, le client gardant alors le texte partiel.
 *
 * La file est **poussée**, jamais tirée : la passerelle avance et finalise
 * l'échange que quelqu'un lise ou non (AD-6 : « une déconnexion client ne
 * change rien à cette séquence »). Un consommateur qui s'en va — `return()`
 * sur l'itérateur — n'interrompt rien ; ce qui est poussé ensuite reste en
 * mémoire le temps de l'appel, borné par `max_tokens`, puis part avec la file.
 */

export type AgentEvent =
  | {readonly type: 'delta'; readonly text: string}
  | {readonly type: 'done'; readonly sources: readonly string[]; readonly exchangeId: string}
  | {readonly type: 'error'; readonly reason: 'model_unavailable'};

/** Une file asynchrone à un producteur et un consommateur, close par le producteur. */
export class EventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private closed = false;
  private waiting: (() => void) | null = null;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }
}
