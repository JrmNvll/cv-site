'use client';

/**
 * Le numéro de téléphone, à la demande — AD-8.
 *
 * Trois propriétés, dans l'ordre d'importance :
 *
 *  1. **Le numéro n'est jamais dans le HTML servi.** Il n'est ni une propriété
 *     de ce composant, ni une valeur rendue côté serveur : il arrive par
 *     `GET /api/contact/phone`, après un clic, et n'existe que dans l'état du
 *     navigateur. C'est ce qu'AD-8 exige, et `tests/e2e/no-leak.spec.ts` le
 *     vérifie sur le document réel.
 *  2. **Sans JavaScript, le bouton n'existe pas.** Le premier rendu — serveur
 *     comme client — ne rend rien ; l'effet de montage le fait apparaître.
 *     Proposer un bouton qui ne peut rien faire serait pire que ne rien
 *     proposer : le courriel, lui, reste là et fonctionne toujours.
 *  3. **Un échec se dit.** Si la route ne répond pas, le visiteur lit un
 *     message et retrouve le courriel juste à côté — il n'attend pas devant un
 *     bouton muet.
 */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';

/**
 * « Sommes-nous côté navigateur, après hydratation ? »
 *
 * `useSyncExternalStore` plutôt qu'un `useState` basculé dans un effet : c'est
 * la même question posée à React sans provoquer de rendu en cascade — le
 * serveur lit `false`, le navigateur `true` une fois hydraté. Les trois
 * fonctions sont définies **hors** du composant pour garder leur identité d'un
 * rendu à l'autre, sinon React se réabonnerait sans fin.
 */
const sansAbonnement = () => () => {};
const surLeNavigateur = () => true;
const surLeServeur = () => false;

/** Au-delà, la route ne répondra plus : le visiteur lit un message, pas un sablier. */
const DELAI_MS = 8000;

export type PhoneRevealProps = {
  readonly labels: {
    /** Libellé du bouton. */
    readonly reveal: string;
    /** Pendant la requête. */
    readonly pending: string;
    /** Préfixe du numéro révélé, pour un lecteur d'écran. */
    readonly label: string;
    /** Message d'échec. */
    readonly unavailable: string;
  };
};

type State =
  | {readonly step: 'idle'}
  | {readonly step: 'pending'}
  | {readonly step: 'done'; readonly telephone: string}
  | {readonly step: 'failed'};

/** Les espaces d'un numéro lisible n'ont rien à faire dans un lien `tel:`. */
export function telHref(telephone: string): string {
  return `tel:${telephone.replace(/[^+0-9]/g, '')}`;
}

export function PhoneReveal({labels}: PhoneRevealProps) {
  const hydrate = useSyncExternalStore(sansAbonnement, surLeNavigateur, surLeServeur);
  const [state, setState] = useState<State>({step: 'idle'});
  const lien = useRef<HTMLAnchorElement>(null);

  // Le bouton disparaît au profit du lien : sans ceci, le focus clavier
  // retomberait sur le document, et un lecteur d'écran perdrait sa place.
  useEffect(() => {
    if (state.step === 'done') lien.current?.focus();
  }, [state.step]);

  async function reveal() {
    setState({step: 'pending'});
    try {
      const response = await fetch('/api/contact/phone', {
        headers: {accept: 'application/json'},
        signal: AbortSignal.timeout(DELAI_MS)
      });
      if (!response.ok) throw new Error(`réponse ${response.status}`);
      const payload: unknown = await response.json();
      const telephone =
        typeof payload === 'object' && payload !== null
          ? (payload as {telephone?: unknown}).telephone
          : undefined;
      if (typeof telephone !== 'string' || telephone === '') throw new Error('réponse sans numéro');
      setState({step: 'done', telephone});
    } catch {
      setState({step: 'failed'});
    }
  }

  // Sans JavaScript, rien n'est rendu : ni bouton mort, ni place vide.
  if (!hydrate) return null;

  if (state.step === 'done') {
    return (
      <a
        ref={lien}
        href={telHref(state.telephone)}
        className="text-accent underline-offset-4 hover:text-accent-strong hover:underline"
      >
        <span className="sr-only">{labels.label} : </span>
        {state.telephone}
      </a>
    );
  }

  if (state.step === 'failed') {
    return (
      <span role="status" className="text-ink-muted">
        {labels.unavailable}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={reveal}
      disabled={state.step === 'pending'}
      className="cursor-pointer text-accent underline-offset-4 hover:text-accent-strong hover:underline disabled:cursor-progress"
    >
      {state.step === 'pending' ? labels.pending : labels.reveal}
    </button>
  );
}
