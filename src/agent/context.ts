/**
 * L'assemblage du contexte — AD-3, et rien d'autre que ce qu'AD-3 énumère.
 *
 * `system` : un seul bloc, règles fixes puis noyau, avec le marqueur de cache —
 * **identique octet pour octet** d'un appel à l'autre dans une langue (AD-6,
 * « Cache de prompt »), **et d'un mode à l'autre** : une question libre et une
 * annonce à évaluer partagent le même préfixe. `messages` : l'historique de la
 * session en tours alternés, puis un dernier message du visiteur qui porte les
 * entrées récupérées et la requête — `<question>` ou `<annonce>`, c'est ce qui
 * dit le mode au modèle. Tout ce qui varie est là, après le point de cache.
 *
 * Déterministe : mêmes entrées, même contexte. Aucune date, aucun identifiant.
 * Aucun appel au modèle pour choisir les entrées : c'est l'index BM25+ de
 * `knowledge` qui les classe — l'annonce est la requête comme la question l'est
 * (AD-3, d).
 *
 * Les types ci-dessous sont **structurellement** ceux du SDK (un bloc `text`
 * avec `cache_control`, des messages `user` / `assistant` à contenu texte) ;
 * ils sont écrits ici plutôt qu'importés parce qu'un seul fichier importe le
 * SDK — `gateway.ts` — et que le contexte doit rester lisible et testable
 * sans lui.
 */
import {core, corpusLang, retrieve, type Lang} from '@/knowledge';
import {MESSAGE_LABELS, rules} from './prompts';

export type SystemBlock = {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control: {readonly type: 'ephemeral'};
};

export type ContextMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

/**
 * Un échange passé de la session, réponse **sans** bloc `<sources>` ni marques.
 * `kind` : une réponse `hero` est écrite par la personne elle-même, à la
 * première personne ; rejouée comme tour `assistant`, elle est marquée comme
 * lue dans le dossier, pas dite par l'assistant. Un tour `match` reprend sa
 * réponse, mais son annonce est remplacée par une ligne repère.
 */
export type HistoryTurn = {
  readonly kind: 'hero' | 'chat' | 'match';
  readonly question: string;
  readonly answer: string;
};

export type ModelContext = {
  readonly system: readonly [SystemBlock];
  readonly messages: readonly ContextMessage[];
  /** Les identifiants des entrées récupérées, pour la journalisation — jamais leur texte. */
  readonly retrieved: readonly string[];
};

/** Ce que le dernier message porte : une question libre, ou une annonce à évaluer. */
export type ContextMode = 'ask' | 'match';

export type BuildContextInput = {
  readonly lang: Lang;
  /** La question du visiteur — ou, en mode `match`, l'annonce entière. */
  readonly question: string;
  /** Du plus ancien au plus récent (AD-3, c). */
  readonly history: readonly HistoryTurn[];
  /** `ask` par défaut : le dernier message porte `<question>` ; `match` : `<annonce>`. */
  readonly mode?: ContextMode;
};

/**
 * Une balise tapée par le visiteur ne doit pas pouvoir fermer son bloc et faire
 * passer la suite pour du dossier — ni porter la balise de l'autre mode : une
 * question qui contient `<annonce>` ne doit pas ressembler à une annonce, une
 * annonce qui contient `<question>` ne doit pas ressembler à une question.
 * **Les deux balises** sont neutralisées dans **les deux modes**, en crochets,
 * lisibles, inoffensives. Casse ignorée, espaces tolérés.
 */
const REQUEST_TAG = /<\s*(\/?)\s*(question|annonce)\s*>/gi;

function neutralizeTags(text: string): string {
  return text.replace(REQUEST_TAG, (_match, slash: string, tag: string) => `[${slash}${tag.toLowerCase()}]`);
}

/** `<question>`, `</question>`, `<annonce>`, `</annonce>` dans une question : neutralisées. */
export function neutralizeQuestion(question: string): string {
  return neutralizeTags(question);
}

/** Les mêmes dans une annonce : neutralisées — même geste. */
export function neutralizeAd(ad: string): string {
  return neutralizeTags(ad);
}

/**
 * Le dernier message : le dossier dans `<dossier>`, la requête dans
 * `<question>` ou `<annonce>`. Deux blocs fermés, jamais une simple
 * concaténation : les règles fixes disent que seul `<dossier>` fait foi, et une
 * question qui imite une entrée (`## qa:lic-01 — …`) reste ce qu'elle est — une
 * question ; une annonce qui porte une consigne reste une annonce.
 */
function visitorMessage(
  lang: Lang,
  mode: ContextMode,
  query: string,
  entries: readonly {source: string; question: string; corps: string}[]
): string {
  const labels = MESSAGE_LABELS[lang];
  const intro = mode === 'match' ? labels.annonce : labels.entries;
  const none = mode === 'match' ? labels.annonceNone : labels.none;
  const dossier =
    entries.length === 0
      ? none
      : [intro, '', ...entries.map((entry) => `## ${entry.source} — ${entry.question}\n${entry.corps}`)].join('\n\n');
  const request =
    mode === 'match'
      ? `<annonce>\n${neutralizeAd(query)}\n</annonce>`
      : `<question>\n${neutralizeQuestion(query)}\n</question>`;
  return `<dossier>\n${dossier}\n</dossier>\n\n${request}`;
}

export function buildContext({lang, question, history, mode = 'ask'}: BuildContextInput): ModelContext {
  const entries = retrieve(lang, question);
  const system: SystemBlock = {
    type: 'text',
    text: `${rules({lang, corpusLang: corpusLang(lang)})}\n\n${core(lang)}`,
    cache_control: {type: 'ephemeral'}
  };

  const messages: ContextMessage[] = [];
  for (const turn of history) {
    // Une réponse vide n'est pas un tour : l'API refuse un contenu vide.
    if (turn.question.trim() === '' || turn.answer.trim() === '') continue;
    // Une annonce déjà évaluée n'est pas rejouée : huit mille caractères six
    // fois seraient un coût pour rien ; un repère la remplace, la réponse reste.
    messages.push({role: 'user', content: turn.kind === 'match' ? MESSAGE_LABELS[lang].matchTurn : turn.question});
    messages.push({
      role: 'assistant',
      content: turn.kind === 'hero' ? `${MESSAGE_LABELS[lang].hero}\n${turn.answer}` : turn.answer
    });
  }
  messages.push({role: 'user', content: visitorMessage(lang, mode, question, entries)});

  return {system: [system], messages, retrieved: entries.map((entry) => entry.source)};
}

/** La taille de ce qui part : ce que la réservation estime en jetons. */
export function contextChars(context: ModelContext): number {
  return (
    context.system.reduce((total, block) => total + block.text.length, 0) +
    context.messages.reduce((total, message) => total + message.content.length, 0)
  );
}
