'use client';

/**
 * Les puces du panneau et la zone de réponse — la partie vivante de l'assistant.
 *
 * Le cadre (titre, intro, champ libre, ligne d'état) reste un composant
 * serveur (`assistant-panel.tsx`) ; ceci ne reçoit que des **libellés et des
 * identifiants** — jamais un texte de contenu : la réponse arrive par la route
 * `/api/questions/<id>?lang=`, après un clic, et n'existe que dans l'état du
 * navigateur. Même motif que `contact-reveal.tsx`, trois propriétés :
 *
 *  1. **Rien n'est actif avant l'hydratation.** Le premier rendu — serveur
 *     comme client — laisse les puces `disabled` ; sans JavaScript, elles le
 *     restent, comme avant cette story : un bouton visiblement hors service
 *     vaut mieux qu'un bouton qui ne fait rien.
 *  2. **Une requête à la fois.** Pendant l'attente, les puces se désactivent
 *     et l'attente s'affiche ; un second clic ne part pas. Au-delà de huit
 *     secondes, la route ne répondra plus : le visiteur lit un message.
 *  3. **Un échec se dit, localisé**, et les puces se réactivent.
 *
 * Deux copies vivent dans le document (premier écran, tiroir mobile) : chacune
 * porte son état, un clic dans le tiroir répond dans le tiroir.
 *
 * La sixième puce (`annonce`) reste inerte : elle appelle le modèle (CAP-4,
 * story 7), et l'activer sans passerelle serait un bouton qui promet.
 */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {
  parseHeroAnswer,
  parseRefusalReason,
  type HeroAnswerView
} from '@/app/_lib/questions-contract';
import {renderMarkdown} from './markdown';
import {timeoutSignal} from './timeout-signal';

/**
 * « Sommes-nous côté navigateur, après hydratation ? » — voir `contact-reveal.tsx`
 * : les trois fonctions vivent hors du composant pour garder leur identité.
 */
const sansAbonnement = () => () => {};
const surLeNavigateur = () => true;
const surLeServeur = () => false;

/** Au-delà, la route ne répondra plus : le visiteur lit un message, pas un sablier. */
const DELAI_MS = 8000;

const CHIP =
  'max-w-full cursor-pointer rounded-full border border-panel-rule bg-panel-raised px-3 py-1.5 text-left text-[13px] text-panel-ink hover:border-panel-accent disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-panel-rule';

const MATCH_CHIP =
  'max-w-full rounded-full border border-panel-accent bg-panel-accent px-3 py-1.5 text-left text-[13px] font-semibold text-panel disabled:cursor-not-allowed disabled:opacity-70';

export type HeroQuestionChip = {
  readonly id: string;
  readonly label: string;
};

export type HeroQuestionsClientProps = {
  /** La langue de la page, celle de l'URL : la route sert le corpus de cette langue. */
  readonly lang: string;
  /** Les cinq puces, par rangée d'affichage. */
  readonly rows: readonly (readonly HeroQuestionChip[])[];
  /** Le libellé de la sixième, inerte. */
  readonly matchLabel: string;
  readonly labels: {
    /** Pendant la requête. */
    readonly loading: string;
    /** La mention sous la réponse : écrite, sans appel au modèle. */
    readonly answerSource: string;
    /** Le bouton qui ramène aux questions. */
    readonly back: string;
    /** La ligne d'état une fois hydraté : ce qui répond, ce qui ne répond pas encore. */
    readonly inactive: string;
    /** La ligne d'état rendue par le serveur — celle que lit un visiteur sans JavaScript. */
    readonly withoutScript: string;
  };
  /** Les messages d'échec, par `reason` de la route ; `unavailable` pour le reste. */
  readonly errors: {
    readonly unavailable: string;
    readonly invalid_input: string;
    readonly content_unavailable: string;
  };
};

type State =
  | {readonly step: 'idle'}
  | {readonly step: 'pending'; readonly id: string}
  | {readonly step: 'done'; readonly id: string; readonly view: HeroAnswerView}
  | {readonly step: 'failed'; readonly message: string};

export function HeroQuestionsClient({lang, rows, matchLabel, labels, errors}: HeroQuestionsClientProps) {
  const hydrate = useSyncExternalStore(sansAbonnement, surLeNavigateur, surLeServeur);
  const [state, setState] = useState<State>({step: 'idle'});
  const titreReponse = useRef<HTMLHeadingElement>(null);
  const puces = useRef(new Map<string, HTMLButtonElement>());
  /** La puce cliquée en dernier : c'est à elle que le focus revient. */
  const derniere = useRef<string | null>(null);
  /**
   * Une requête en cours — tenue hors de l'état : les puces sont désactivées
   * pendant l'attente, mais deux clics dans le même tour de boucle liraient le
   * même état et partiraient tous deux.
   */
  const enCours = useRef(false);

  // Les puces disparaissent au profit de la réponse : sans ceci, le focus
  // clavier retomberait sur le document, et un lecteur d'écran perdrait sa
  // place. Au retour — et après un échec, où la puce cliquée a été désactivée
  // le temps de l'attente — il revient sur la puce qui a posé la question.
  useEffect(() => {
    if (state.step === 'done') titreReponse.current?.focus();
    if ((state.step === 'idle' || state.step === 'failed') && derniere.current !== null) {
      puces.current.get(derniere.current)?.focus();
    }
  }, [state.step]);

  async function ask(id: string) {
    if (enCours.current) return;
    enCours.current = true;
    derniere.current = id;
    setState({step: 'pending', id});
    try {
      const response = await fetch(`/api/questions/${id}?lang=${encodeURIComponent(lang)}`, {
        headers: {accept: 'application/json'},
        signal: timeoutSignal(DELAI_MS)
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = parseRefusalReason(payload);
        const message =
          reason === 'invalid_input'
            ? errors.invalid_input
            : reason === 'content_unavailable'
              ? errors.content_unavailable
              : errors.unavailable;
        setState({step: 'failed', message});
        return;
      }
      const view = parseHeroAnswer(payload);
      if (view === null) throw new Error('réponse sans question ni corps');
      setState({step: 'done', id, view});
    } catch {
      setState({step: 'failed', message: errors.unavailable});
    } finally {
      enCours.current = false;
    }
  }

  if (state.step === 'done') {
    return (
      <div className="mt-3.5 flex flex-col gap-3">
        <h3
          ref={titreReponse}
          tabIndex={-1}
          className="text-[14px] font-semibold text-panel-ink outline-none"
        >
          {state.view.question}
        </h3>
        <div className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-panel-ink-soft [&_em]:italic [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-panel-ink [&_ul]:list-disc [&_ul]:pl-5">
          {renderMarkdown(state.view.answer)}
        </div>
        <p className="text-[12px] text-panel-ink-muted">{labels.answerSource}</p>
        <div>
          <button
            type="button"
            onClick={() => setState({step: 'idle'})}
            className="cursor-pointer text-[13px] text-panel-accent underline-offset-4 hover:underline"
          >
            {labels.back}
          </button>
        </div>
      </div>
    );
  }

  const inactif = !hydrate || state.step === 'pending';

  return (
    <div className="mt-3.5 flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.map((chip) => chip.id).join('-')} className="flex flex-wrap gap-1.5">
          {row.map((chip) => (
            <button
              key={chip.id}
              ref={(element) => {
                if (element === null) puces.current.delete(chip.id);
                else puces.current.set(chip.id, element);
              }}
              type="button"
              disabled={inactif}
              aria-busy={state.step === 'pending' && state.id === chip.id ? true : undefined}
              onClick={() => ask(chip.id)}
              className={CHIP}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {/* La sixième : elle n'interroge pas le corpus, elle ouvrira
            l'évaluation d'adéquation (CAP-4). D'où l'accent, et l'inertie. */}
        <button type="button" disabled className={MATCH_CHIP}>
          {matchLabel}
        </button>
      </div>

      {state.step === 'pending' ? (
        <p role="status" className="mt-2 text-[13px] text-panel-ink-muted">
          {labels.loading}
        </p>
      ) : null}
      {state.step === 'failed' ? (
        <p role="alert" className="mt-2 text-[13px] text-panel-ink-soft">
          {state.message}
        </p>
      ) : null}
      {/* La ligne d'état dit vrai dans les deux cas : le serveur rend celle du
          visiteur sans JavaScript (les puces y restent désactivées) ; une fois
          hydraté, celle qui dit ce qui répond et ce qui ne répond pas encore. */}
      <p className="mt-2.5 text-[12px] text-panel-ink-muted">
        {hydrate ? labels.inactive : labels.withoutScript}
      </p>
    </div>
  );
}
