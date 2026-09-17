/**
 * L'assemblage du contexte — AD-3, et rien d'autre que ce qu'AD-3 énumère.
 *
 * `system` : un seul bloc, règles fixes puis noyau, avec le marqueur de cache —
 * **identique octet pour octet** d'un appel à l'autre dans une langue (AD-6,
 * « Cache de prompt »). `messages` : l'historique de la session en tours
 * alternés, puis un dernier message du visiteur qui porte les entrées
 * récupérées et la question. Tout ce qui varie est là, après le point de cache.
 *
 * Déterministe : mêmes entrées, même contexte. Aucune date, aucun identifiant.
 * Aucun appel au modèle pour choisir les entrées : c'est l'index BM25+ de
 * `knowledge` qui les classe.
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
 * Un échange passé de la session, réponse **sans** bloc `<sources>`. `kind` :
 * une réponse `hero` est écrite par la personne elle-même, à la première
 * personne ; rejouée comme tour `assistant`, elle est marquée comme lue dans
 * le dossier, pas dite par l'assistant.
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

export type BuildContextInput = {
  readonly lang: Lang;
  readonly question: string;
  /** Du plus ancien au plus récent (AD-3, c). */
  readonly history: readonly HistoryTurn[];
};

/**
 * Une balise `<question>` ou `</question>` tapée par le visiteur ne doit pas
 * pouvoir fermer son bloc et faire passer la suite pour du dossier : elle est
 * neutralisée en crochets, lisible, inoffensive. Casse ignorée, espaces tolérés.
 */
export function neutralizeQuestion(question: string): string {
  return question.replace(/<\s*(\/?)\s*question\s*>/gi, '[$1question]');
}

/**
 * Le dernier message : le dossier dans `<dossier>`, la question dans
 * `<question>`. Deux blocs fermés, jamais une simple concaténation : les
 * règles fixes disent que seul `<dossier>` fait foi, et une question qui
 * imite une entrée (`## qa:lic-01 — …`) reste ce qu'elle est — une question.
 */
function visitorMessage(lang: Lang, question: string, entries: readonly {source: string; question: string; corps: string}[]): string {
  const labels = MESSAGE_LABELS[lang];
  const dossier =
    entries.length === 0
      ? labels.none
      : [
          labels.entries,
          '',
          ...entries.map((entry) => `## ${entry.source} — ${entry.question}\n${entry.corps}`)
        ].join('\n\n');
  return `<dossier>\n${dossier}\n</dossier>\n\n<question>\n${neutralizeQuestion(question)}\n</question>`;
}

export function buildContext({lang, question, history}: BuildContextInput): ModelContext {
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
    messages.push({role: 'user', content: turn.question});
    messages.push({
      role: 'assistant',
      content: turn.kind === 'hero' ? `${MESSAGE_LABELS[lang].hero}\n${turn.answer}` : turn.answer
    });
  }
  messages.push({role: 'user', content: visitorMessage(lang, question, entries)});

  return {system: [system], messages, retrieved: entries.map((entry) => entry.source)};
}

/** La taille de ce qui part : ce que la réservation estime en jetons. */
export function contextChars(context: ModelContext): number {
  return (
    context.system.reduce((total, block) => total + block.text.length, 0) +
    context.messages.reduce((total, message) => total + message.content.length, 0)
  );
}
