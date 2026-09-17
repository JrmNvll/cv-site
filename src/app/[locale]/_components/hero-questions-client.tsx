'use client';

/**
 * Les puces, le champ libre et la zone de réponse — la partie vivante de
 * l'assistant.
 *
 * Le cadre (titre, intro, ligne d'état) reste un composant serveur
 * (`assistant-panel.tsx`) ; ceci ne reçoit que des **libellés et des
 * identifiants** — jamais un texte de contenu : une réponse arrive par une
 * route, après un geste, et n'existe que dans l'état du navigateur. Même motif
 * que `contact-reveal.tsx`, trois propriétés :
 *
 *  1. **Rien n'est actif avant l'hydratation.** Le premier rendu — serveur
 *     comme client — laisse les puces et le champ `disabled` ; sans JavaScript,
 *     ils le restent : un champ visiblement hors service vaut mieux qu'un
 *     champ qui ne fait rien.
 *  2. **Une requête à la fois.** Pendant l'attente, puces et champ se
 *     désactivent ; un second envoi ne part pas.
 *  3. **Un échec se dit, localisé**, et tout se réactive.
 *
 * Deux chemins pour une réponse :
 *  - une puce : `GET /api/questions/<id>` rend un JSON, le corps écrit par
 *    Jérémie (story 5) ;
 *  - le champ libre : `POST /api/chat` ouvre un flux SSE (AD-16), le texte
 *    apparaît **au fil de l'eau**, rendu en Markdown à chaque morceau, jamais
 *    en HTML injecté. Un refus préalable est un JSON avec sa raison ; une
 *    erreur en cours de flux garde le texte déjà reçu et le dit ; trente
 *    secondes sans événement valent une indisponibilité. `cap_reached` et
 *    `model_unavailable` renvoient au contact direct de la page (`#contact`).
 *
 * Deux copies vivent dans le document (premier écran, tiroir mobile) : chacune
 * porte son état, un geste dans le tiroir répond dans le tiroir.
 *
 * La sixième puce (`annonce`) reste inerte : elle appelle le modèle sur une
 * annonce collée (CAP-4, story 7), et l'activer sans cette route serait un
 * bouton qui promet.
 */
import {useEffect, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {
  createSseDecoder,
  parseChatRefusal,
  QUESTION_MAX_CHARS,
  type ChatRefusalReason,
  type ChatRequest
} from '@/app/_lib/chat-contract';
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

/** Au-delà, la route des puces ne répondra plus : le visiteur lit un message, pas un sablier. */
const DELAI_MS = 8000;
/** Trente secondes sans événement du flux : le modèle ne viendra plus, on le dit. */
const SILENCE_MS = 30_000;

const CHIP =
  'max-w-full cursor-pointer rounded-full border border-panel-rule bg-panel-raised px-3 py-1.5 text-left text-[13px] text-panel-ink hover:border-panel-accent disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-panel-rule';

const MATCH_CHIP =
  'max-w-full rounded-full border border-panel-accent bg-panel-accent px-3 py-1.5 text-left text-[13px] font-semibold text-panel disabled:cursor-not-allowed disabled:opacity-70';

const ANSWER =
  'flex flex-col gap-2.5 text-[14px] leading-relaxed text-panel-ink-soft [&_em]:italic [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-panel-ink [&_ul]:list-disc [&_ul]:pl-5';

const LINK = 'cursor-pointer text-[13px] text-panel-accent underline-offset-4 hover:underline';

export type HeroQuestionChip = {
  readonly id: string;
  readonly label: string;
};

export type HeroQuestionsClientProps = {
  /** La langue de la page, celle de l'URL : les routes servent le corpus de cette langue. */
  readonly lang: string;
  /** Les cinq puces, par rangée d'affichage. */
  readonly rows: readonly (readonly HeroQuestionChip[])[];
  /** Le libellé de la sixième, inerte. */
  readonly matchLabel: string;
  readonly labels: {
    /** Pendant une requête. */
    readonly loading: string;
    /** La mention sous une réponse écrite : sans appel au modèle. */
    readonly answerSource: string;
    /** La mention sous une réponse du modèle. */
    readonly answerModel: string;
    /** Le bouton qui ramène aux questions. */
    readonly back: string;
    /** La ligne d'état une fois hydraté : ce qui répond, ce qui ne répond pas encore. */
    readonly inactive: string;
    /** La ligne d'état rendue par le serveur — celle que lit un visiteur sans JavaScript. */
    readonly withoutScript: string;
    /** Le champ libre : son texte d'invite, son nom pour un lecteur d'écran, son bouton. */
    readonly placeholder: string;
    readonly questionLabel: string;
    readonly send: string;
    /** Le lien vers les coordonnées, quand l'assistant renvoie au contact direct. */
    readonly contact: string;
  };
  /** Les messages d'échec, par `reason` ; `unavailable` pour tout le reste. */
  readonly errors: {
    readonly unavailable: string;
    readonly invalid_input: string;
    readonly content_unavailable: string;
    readonly no_visitor: string;
    readonly rate_limited: string;
    readonly cap_reached: string;
    readonly model_unavailable: string;
  };
};

/** Un message d'échec, et s'il renvoie au contact direct. */
type Failure = {readonly message: string; readonly contact: boolean};

type State =
  | {readonly step: 'idle'}
  | {readonly step: 'pending'; readonly id: string}
  | {readonly step: 'done'; readonly id: string; readonly view: HeroAnswerView}
  | {readonly step: 'failed'; readonly failure: Failure}
  | {readonly step: 'streaming'; readonly question: string; readonly text: string}
  | {readonly step: 'answered'; readonly question: string; readonly text: string; readonly sources: number}
  | {readonly step: 'interrupted'; readonly question: string; readonly text: string; readonly failure: Failure};

/** Ce vers quoi le focus revient au retour : la puce cliquée, ou le champ. */
type Origin = {readonly kind: 'chip'; readonly id: string} | {readonly kind: 'field'};

export function HeroQuestionsClient({lang, rows, matchLabel, labels, errors}: HeroQuestionsClientProps) {
  const hydrate = useSyncExternalStore(sansAbonnement, surLeNavigateur, surLeServeur);
  // Le seul libellé formaté au moment de l'affichage : le nombre de sources
  // n'est connu qu'à la fin du flux, et un pluriel ICU ne se calcule pas en
  // amont. Les autres libellés arrivent en propriétés, comme partout.
  const t = useTranslations('assistant');
  const [state, setState] = useState<State>({step: 'idle'});
  const [question, setQuestion] = useState('');
  const titreReponse = useRef<HTMLHeadingElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const puces = useRef(new Map<string, HTMLButtonElement>());
  /** D'où la dernière question est partie : c'est là que le focus revient. */
  const origine = useRef<Origin | null>(null);
  /**
   * Une requête en cours — tenue hors de l'état : puces et champ sont
   * désactivés pendant l'attente, mais deux gestes dans le même tour de boucle
   * liraient le même état et partiraient tous deux.
   */
  const enCours = useRef(false);

  // Les puces disparaissent au profit de la réponse : sans ceci, le focus
  // clavier retomberait sur le document, et un lecteur d'écran perdrait sa
  // place. Au retour — et après un échec, où tout a été désactivé le temps de
  // l'attente — il revient sur ce qui a posé la question.
  useEffect(() => {
    if (state.step === 'done' || state.step === 'streaming') titreReponse.current?.focus();
    if (state.step === 'idle' || state.step === 'failed') {
      const from = origine.current;
      if (from?.kind === 'chip') puces.current.get(from.id)?.focus();
      if (from?.kind === 'field') champ.current?.focus();
    }
  }, [state.step]);

  const failureFor = (reason: ChatRefusalReason | null): Failure => {
    switch (reason) {
      case 'invalid_input':
        return {message: errors.invalid_input, contact: false};
      case 'no_visitor':
        return {message: errors.no_visitor, contact: false};
      case 'rate_limited':
        return {message: errors.rate_limited, contact: false};
      case 'cap_reached':
        return {message: errors.cap_reached, contact: true};
      case 'model_unavailable':
        return {message: errors.model_unavailable, contact: true};
      default:
        return {message: errors.unavailable, contact: false};
    }
  };

  async function ask(id: string) {
    if (enCours.current) return;
    enCours.current = true;
    origine.current = {kind: 'chip', id};
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
        setState({step: 'failed', failure: {message, contact: false}});
        return;
      }
      const view = parseHeroAnswer(payload);
      if (view === null) throw new Error('réponse sans question ni corps');
      setState({step: 'done', id, view});
    } catch {
      setState({step: 'failed', failure: {message: errors.unavailable, contact: false}});
    } finally {
      enCours.current = false;
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = question.trim();
    if (enCours.current || asked === '' || asked.length > QUESTION_MAX_CHARS) return;
    enCours.current = true;
    origine.current = {kind: 'field'};
    setState({step: 'streaming', question: asked, text: ''});

    // Le silence est mesuré entre deux morceaux reçus, pas sur le flux entier :
    // une réponse longue a le droit de prendre son temps tant qu'elle avance,
    // et le battement de cœur de la route (`: ping`, un commentaire SSE que
    // l'analyseur ignore) compte comme de l'activité pendant la réflexion.
    const controller = new AbortController();
    let silence: ReturnType<typeof setTimeout> | undefined;
    const rearm = () => {
      clearTimeout(silence);
      silence = setTimeout(() => controller.abort(), SILENCE_MS);
    };

    let text = '';
    let settled = false;
    try {
      rearm();
      const body: ChatRequest = {question: asked, lang};
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'text/event-stream'},
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setState({step: 'failed', failure: failureFor(parseChatRefusal(payload))});
        settled = true;
        return;
      }
      if (response.body === null) throw new Error('flux absent');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sse = createSseDecoder();
      const apply = (events: ReturnType<typeof sse.push>): void => {
        for (const item of events) {
          // Après `done` ou `error`, plus rien ne compte : un événement qui
          // suivrait dans le même morceau ne doit pas rouvrir le flux.
          if (settled) break;
          if (item.type === 'delta') {
            text += item.text;
            setState({step: 'streaming', question: asked, text});
          } else if (item.type === 'done') {
            setState({step: 'answered', question: asked, text, sources: item.sources.length});
            setQuestion('');
            settled = true;
          } else if (item.type === 'error') {
            setState({
              step: 'interrupted',
              question: asked,
              text,
              failure: failureFor('model_unavailable')
            });
            settled = true;
          }
        }
      };

      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        rearm();
        apply(sse.push(decoder.decode(value, {stream: true})));
        if (settled) break;
      }
      if (!settled) apply(sse.end());
      // Un flux fermé sans `done` ni `error` — le serveur est parti — : sans
      // texte, un échec ; avec, une interruption qui garde ce qui est arrivé.
      // Même règle que le `catch`.
      if (!settled) {
        setState(
          text === ''
            ? {step: 'failed', failure: failureFor(null)}
            : {step: 'interrupted', question: asked, text, failure: failureFor(null)}
        );
        settled = true;
      }
    } catch {
      if (!settled) {
        // Réseau, silence de trente secondes, route injoignable : sans texte,
        // un échec ; avec, une interruption qui garde ce qui est arrivé.
        setState(
          text === ''
            ? {step: 'failed', failure: failureFor(null)}
            : {step: 'interrupted', question: asked, text, failure: failureFor(null)}
        );
      }
    } finally {
      clearTimeout(silence);
      enCours.current = false;
    }
  }

  const inactif = !hydrate || state.step === 'pending' || state.step === 'streaming';

  const backButton = (
    <div>
      <button type="button" onClick={() => setState({step: 'idle'})} className={LINK}>
        {labels.back}
      </button>
    </div>
  );

  const failureLine = (failure: Failure) => (
    <p role="alert" className="mt-2 text-[13px] text-panel-ink-soft">
      {failure.message}
      {failure.contact ? (
        <>
          {' '}
          <a href="#contact" className="text-panel-accent underline-offset-4 hover:underline">
            {labels.contact}
          </a>
        </>
      ) : null}
    </p>
  );

  const field = (
    <form
      onSubmit={send}
      className="mt-3.5 flex items-center gap-3 rounded-md border border-panel-rule bg-panel-sunken px-3 py-2"
    >
      <input
        ref={champ}
        type="text"
        name="question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        maxLength={QUESTION_MAX_CHARS}
        disabled={inactif}
        autoComplete="off"
        placeholder={labels.placeholder}
        aria-label={labels.questionLabel}
        className="min-w-0 grow bg-transparent text-[14px] text-panel-ink placeholder:text-panel-ink-muted disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={inactif || question.trim() === ''}
        aria-label={labels.send}
        className="shrink-0 cursor-pointer text-panel-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </form>
  );

  if (state.step === 'done') {
    return (
      <div className="mt-3.5 flex flex-col gap-3">
        <h3 ref={titreReponse} tabIndex={-1} className="text-[14px] font-semibold text-panel-ink outline-none">
          {state.view.question}
        </h3>
        <div className={ANSWER}>{renderMarkdown(state.view.answer)}</div>
        <p className="text-[12px] text-panel-ink-muted">{labels.answerSource}</p>
        {backButton}
        {field}
      </div>
    );
  }

  if (state.step === 'streaming' || state.step === 'answered' || state.step === 'interrupted') {
    const streaming = state.step === 'streaming';
    return (
      <div className="mt-3.5 flex flex-col gap-3" aria-busy={streaming ? true : undefined}>
        <h3 ref={titreReponse} tabIndex={-1} className="text-[14px] font-semibold text-panel-ink outline-none">
          {state.question}
        </h3>
        {streaming && state.text === '' ? (
          <p role="status" className="text-[13px] text-panel-ink-muted">
            {labels.loading}
          </p>
        ) : null}
        {state.text !== '' ? (
          <div data-answer={state.step} className={ANSWER}>
            {renderMarkdown(state.text)}
          </div>
        ) : null}
        {state.step === 'answered' ? (
          <p className="text-[12px] text-panel-ink-muted">
            {labels.answerModel}
            {state.sources > 0 ? ` · ${t('answerSources', {count: state.sources})}` : null}
          </p>
        ) : null}
        {state.step === 'interrupted' ? failureLine(state.failure) : null}
        {streaming ? null : backButton}
        {field}
      </div>
    );
  }

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
      {state.step === 'failed' ? failureLine(state.failure) : null}
      {field}
      {/* La ligne d'état dit vrai dans les deux cas : le serveur rend celle du
          visiteur sans JavaScript (puces et champ y restent désactivés) ; une
          fois hydraté, celle qui dit ce qui répond et ce qui ne répond pas encore. */}
      <p className="mt-2.5 text-[12px] text-panel-ink-muted">
        {hydrate ? labels.inactive : labels.withoutScript}
      </p>
    </div>
  );
}
