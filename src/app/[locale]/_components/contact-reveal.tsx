'use client';

/**
 * Des coordonnées, à la demande — AD-8.
 *
 * Le numéro de Jérémie (`/api/contact/phone`) et les coordonnées d'une
 * référence (`/api/references/<id>/contact`) suivent la même règle, et donc le
 * même composant. Trois propriétés, dans l'ordre d'importance :
 *
 *  1. **Rien n'est jamais dans le HTML servi.** Ni numéro ni courriel ne sont
 *     une propriété de ce composant ou une valeur rendue côté serveur : ils
 *     arrivent par la route, après un clic, et n'existent que dans l'état du
 *     navigateur. C'est ce qu'AD-8 exige, et `tests/e2e/no-leak.spec.ts` le
 *     vérifie sur le document réel.
 *  2. **Sans JavaScript, le bouton n'existe pas.** Le premier rendu — serveur
 *     comme client — ne rend rien ; l'hydratation le fait apparaître. Proposer
 *     un bouton qui ne peut rien faire serait pire que ne rien proposer : le
 *     courriel de Jérémie, lui, reste là et fonctionne toujours.
 *  3. **Un échec se dit.** Si la route ne répond pas, le visiteur lit un
 *     message et sait vers qui se tourner — il n'attend pas devant un bouton
 *     muet.
 */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {timeoutSignal} from './timeout-signal';

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

export type ContactRevealProps = {
  /** La route qui rend `{telephone?, email?}` — jamais rendue côté serveur. */
  readonly endpoint: string;
  readonly labels: {
    /** Libellé du bouton. */
    readonly reveal: string;
    /** Pendant la requête. */
    readonly pending: string;
    /** Préfixe des coordonnées révélées, pour un lecteur d'écran. */
    readonly label: string;
    /** Message d'échec. */
    readonly unavailable: string;
  };
};

export type Contact = {readonly telephone?: string; readonly email?: string};

type State =
  | {readonly step: 'idle'}
  | {readonly step: 'pending'}
  | {readonly step: 'done'; readonly contact: Contact}
  | {readonly step: 'failed'};

/** Les espaces d'un numéro lisible n'ont rien à faire dans un lien `tel:`. */
export function telHref(telephone: string): string {
  return `tel:${telephone.replace(/[^+0-9]/g, '')}`;
}

/**
 * Ce que la route a rendu, ou `null` si ce n'est pas une coordonnée : un corps
 * inattendu vaut un échec, pas un lien vide.
 */
export function parseContact(payload: unknown): Contact | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const {telephone, email} = payload as {telephone?: unknown; email?: unknown};
  const contact: Contact = {
    ...(typeof telephone === 'string' && telephone !== '' ? {telephone} : {}),
    ...(typeof email === 'string' && email !== '' ? {email} : {})
  };
  return contact.telephone === undefined && contact.email === undefined ? null : contact;
}

export function ContactReveal({endpoint, labels}: ContactRevealProps) {
  const hydrate = useSyncExternalStore(sansAbonnement, surLeNavigateur, surLeServeur);
  const [state, setState] = useState<State>({step: 'idle'});
  const premierLien = useRef<HTMLAnchorElement>(null);

  // Le bouton disparaît au profit des liens : sans ceci, le focus clavier
  // retomberait sur le document, et un lecteur d'écran perdrait sa place.
  useEffect(() => {
    if (state.step === 'done') premierLien.current?.focus();
  }, [state.step]);

  async function reveal() {
    setState({step: 'pending'});
    try {
      const response = await fetch(endpoint, {
        headers: {accept: 'application/json'},
        signal: timeoutSignal(DELAI_MS)
      });
      if (!response.ok) throw new Error(`réponse ${response.status}`);
      const contact = parseContact(await response.json());
      if (contact === null) throw new Error('réponse sans coordonnées');
      setState({step: 'done', contact});
    } catch {
      setState({step: 'failed'});
    }
  }

  // Sans JavaScript, rien n'est rendu : ni bouton mort, ni place vide.
  if (!hydrate) return null;

  if (state.step === 'done') {
    const {email, telephone} = state.contact;
    const lien = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';
    return (
      <span>
        <span className="sr-only">{labels.label} : </span>
        {email === undefined ? null : (
          <a ref={premierLien} href={`mailto:${email}`} className={`break-all ${lien}`}>
            {email}
          </a>
        )}
        {email !== undefined && telephone !== undefined ? ' · ' : null}
        {telephone === undefined ? null : (
          <a
            ref={email === undefined ? premierLien : undefined}
            href={telHref(telephone)}
            className={lien}
          >
            {telephone}
          </a>
        )}
      </span>
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
