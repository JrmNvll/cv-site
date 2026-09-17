/**
 * Couche `knowledge` — frontière.
 *
 * Responsabilité : index de récupération lexicale (BM25+) par langue, noyau
 * toujours injecté et index des titres (AD-3).
 *
 * Dépendances autorisées : `content`, `src/lib/`, `src/env.ts`.
 * Interdites : `agent`, `journal`, `app`. `app` n'importe jamais cette couche :
 * seul `agent` assemble un contexte.
 *
 * **Tout se construit au démarrage** (`ensureKnowledge()`, appelé par
 * l'amorçage) et **rien ne change ensuite** : le noyau d'une langue est une
 * chaîne figée, **identique octet pour octet** d'un appel à l'autre — c'est le
 * préfixe de cache du modèle (AD-6, « Cache de prompt »). Aucune date, aucun
 * identifiant de requête n'y entre ; la sérialisation est déterministe ; deux
 * constructions sur le même contenu donnent les mêmes octets.
 *
 * Ce qui entre dans le noyau (AD-3) : la projection `agent` de `cv.yaml` avec
 * ses clés de citation ; l'index des titres (identifiant + question de chaque
 * entrée non vide, pour que le modèle sache ce qui existe) ; le corps des
 * entrées `sys-*` ; et, pour chaque entrée `PRIVÉ` ou portant une consigne,
 * son identifiant, son statut et sa consigne — **jamais le corps d'une entrée
 * `PRIVÉ`** (la couche `content` ne le rend d'ailleurs pas). `PASSE` est
 * ignoré partout.
 *
 * Ce qui entre dans l'index : les entrées `normale` hors `sys-*` (déjà dans le
 * noyau), question et corps **débalisé**. La récupération rend le corps tel
 * qu'écrit, en Markdown.
 *
 * L'état vit sur `globalThis`, comme la connexion du journal : Turbopack
 * construit plusieurs graphes de modules pour le serveur, et un noyau construit
 * deux fois serait identique — mais construit deux fois pour rien.
 */
import MiniSearch from 'minisearch';
import {agentProjection, corpus, LANGS, type Lang, type QaEntry} from '@/content';
import {stripMarkdown} from './strip-markdown';

export type {Lang} from '@/content';
export {LANGS} from '@/content';

/** Le nombre d'entrées récupérées par défaut — les « 12 entrées les mieux classées » d'AD-3. */
export const RETRIEVE_K = 12;

/** Une entrée récupérée pour le contexte : son corps en Markdown, tel qu'écrit. */
export type RetrievedEntry = {
  readonly id: string;
  /** Clé de citation `qa:<id>`. */
  readonly source: string;
  readonly question: string;
  readonly corps: string;
};

/** Ce que le démarrage journalise : des tailles, jamais un texte. */
export type KnowledgeStats = {
  readonly lang: Lang;
  /** La langue du corpus effectivement indexé — `fr` pour `en` en repli (AD-5). */
  readonly corpusLang: Lang;
  readonly coreChars: number;
  readonly titles: number;
  readonly indexed: number;
  readonly directives: number;
};

type IndexedDoc = {readonly id: string; readonly question: string; readonly body: string};

type LangKnowledge = {
  readonly lang: Lang;
  readonly corpusLang: Lang;
  readonly core: string;
  readonly index: MiniSearch<IndexedDoc>;
  /** Les entrées que l'index peut rendre, par identifiant. */
  readonly retrievable: ReadonlyMap<string, RetrievedEntry>;
  /** Les clés de citation valides (AD-4) : `qa:<id>` des entrées ordinaires, `cv:*` de la projection. */
  readonly citable: ReadonlySet<string>;
  readonly stats: KnowledgeStats;
};

type Holder = {byLang: Readonly<Record<Lang, LangKnowledge>> | null};
const HOLDER = Symbol.for('cv-site.knowledge');
const holder: Holder = ((globalThis as unknown as Record<symbol, Holder | undefined>)[HOLDER] ??=
  {byLang: null});

/** Les entrées de comportement de l'agent, toujours dans le noyau (AD-3). */
export function isSystemEntry(id: string): boolean {
  return id.startsWith('sys-');
}

/**
 * Un terme de l'index : minuscules, sans accents. « Développeur » et
 * « developpeur » doivent se retrouver. Un terme d'un seul caractère est
 * gardé : « C », « R », « C# » (dont le tokeniseur ne garde que « c ») sont
 * des langages qu'une question peut viser, et BM25 pèse déjà peu un terme
 * présent partout (« l » de « l'agent »).
 */
function processTerm(term: string): string | null {
  const plain = term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return plain.length >= 1 ? plain : null;
}

/** Les clés de citation `cv:*` que porte la projection (`scripts/check-content.mjs` fait de même). */
function sourceKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => sourceKeys(item, found));
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.source === 'string') found.push(record.source);
    Object.values(record).forEach((item) => sourceKeys(item, found));
  }
  return found;
}

type CoreStats = Pick<KnowledgeStats, 'titles' | 'directives'>;

/**
 * Le noyau d'une langue — une chaîne, construite une fois.
 *
 * Quatre sections balisées, dans un ordre fixe. Les balises sont des repères
 * machine, les mêmes dans les deux langues ; ce sont les règles fixes du
 * prompt (`src/agent/prompts.ts`) qui les expliquent au modèle, dans la langue
 * de la réponse.
 */
function buildCore(lang: Lang, entries: readonly QaEntry[]): {core: string; stats: CoreStats} {
  const projection = agentProjection(lang);

  const titles = entries
    .filter((entry) => entry.statut === 'normale' || entry.statut === 'PRIVÉ')
    .map((entry) =>
      entry.statut === 'PRIVÉ'
        ? `${entry.source} [PRIVÉ] — ${entry.question}`
        : `${entry.source} — ${entry.question}`
    );

  const behaviour = entries
    .filter((entry) => entry.statut === 'normale' && isSystemEntry(entry.id))
    .map((entry) => `## ${entry.source} — ${entry.question}\n${entry.corps ?? ''}`);

  const directives = entries
    .filter((entry) => entry.statut !== 'PASSE' && (entry.statut === 'PRIVÉ' || entry.consigne !== null))
    .map((entry) => {
      const status = entry.statut === 'PRIVÉ' ? ' [PRIVÉ]' : '';
      return `## ${entry.source}${status} — ${entry.question}\n${entry.consigne ?? '—'}`;
    });

  const core = [
    '<cv>',
    JSON.stringify(projection, null, 1),
    '</cv>',
    '',
    '<titles>',
    titles.join('\n'),
    '</titles>',
    '',
    '<behaviour>',
    behaviour.join('\n\n'),
    '</behaviour>',
    '',
    '<directives>',
    directives.join('\n\n'),
    '</directives>'
  ].join('\n');

  return {core, stats: {titles: titles.length, directives: directives.length}};
}

function buildLang(lang: Lang, corpusLang: Lang): LangKnowledge {
  const entries = corpus(corpusLang);
  const {core, stats} = buildCore(lang, entries);

  const retrievable = new Map<string, RetrievedEntry>();
  const docs: IndexedDoc[] = [];
  for (const entry of entries) {
    if (entry.statut !== 'normale' || isSystemEntry(entry.id)) continue;
    const corps = entry.corps ?? '';
    retrievable.set(entry.id, {id: entry.id, source: entry.source, question: entry.question, corps});
    docs.push({id: entry.id, question: entry.question, body: stripMarkdown(corps)});
  }

  const index = new MiniSearch<IndexedDoc>({
    fields: ['question', 'body'],
    idField: 'id',
    processTerm,
    searchOptions: {
      processTerm,
      // La question d'une entrée est ce qui ressemble le plus à la question
      // d'un visiteur : elle pèse deux fois le corps.
      boost: {question: 2},
      prefix: true,
      fuzzy: 0.2
    }
  });
  index.addAll(docs);

  const citable = new Set<string>();
  for (const entry of entries) {
    if (entry.statut === 'normale') citable.add(entry.source);
  }
  for (const key of sourceKeys(agentProjection(lang))) citable.add(key);

  return {
    lang,
    corpusLang,
    core,
    index,
    retrievable,
    citable,
    stats: {lang, corpusLang, coreChars: core.length, indexed: docs.length, ...stats}
  };
}

function build(): Readonly<Record<Lang, LangKnowledge>> {
  const built = {} as Record<Lang, LangKnowledge>;
  for (const lang of LANGS) {
    // Un corpus vide dans cette langue — `qa.en.md` absent — s'ancre sur le
    // français avec la consigne de répondre dans la langue de la page (AD-5).
    // Le français lui-même ne peut pas être vide : `content` a déjà refusé.
    const corpusLang: Lang = corpus(lang).length > 0 ? lang : 'fr';
    if (corpusLang !== lang) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'knowledge.corpus_fallback',
          lang,
          corpusLang,
          text: `Corpus « ${lang} » vide : l'agent s'ancre sur le corpus « ${corpusLang} » et répond en « ${lang} ».`
        })
      );
    }
    built[lang] = buildLang(lang, corpusLang);
  }
  return Object.freeze(built);
}

function knowledge(): Readonly<Record<Lang, LangKnowledge>> {
  return (holder.byLang ??= build());
}

/**
 * Construit le noyau et l'index des deux langues maintenant. Appelé au
 * démarrage : une entrée qui casse l'index doit arrêter le processus au
 * lancement, pas à la première question d'un recruteur (AD-2, AD-3).
 */
export function ensureKnowledge(): readonly KnowledgeStats[] {
  return LANGS.map((lang) => knowledge()[lang].stats);
}

/** Le noyau d'une langue : la même chaîne à chaque appel. */
export function core(lang: Lang): string {
  return knowledge()[lang].core;
}

/** La langue du corpus effectivement indexé pour cette langue — `fr` en repli (AD-5). */
export function corpusLang(lang: Lang): Lang {
  return knowledge()[lang].corpusLang;
}

/**
 * Les `k` entrées les mieux classées pour une requête, dans l'ordre du score.
 * Entrées ordinaires hors `sys-*` seulement ; corps en Markdown, tel qu'écrit.
 */
export function retrieve(lang: Lang, query: string, k = RETRIEVE_K): readonly RetrievedEntry[] {
  const {index, retrievable} = knowledge()[lang];
  if (query.trim() === '' || k <= 0) return [];
  const found: RetrievedEntry[] = [];
  for (const result of index.search(query)) {
    const entry = retrievable.get(String(result.id));
    if (entry === undefined) continue;
    found.push(entry);
    if (found.length >= k) break;
  }
  return found;
}

/**
 * Une source est valide si elle existe dans l'index ou la projection de la
 * langue courante, n'est pas vide et n'est pas `PRIVÉ` (AD-4). Ce qui arrive
 * ici vient du modèle : une clé inconnue est simplement fausse.
 */
export function isValidSource(lang: Lang, id: string): boolean {
  return knowledge()[lang].citable.has(id);
}

/**
 * Oublie ce qui a été construit — pour les tests, qui changent de contenu
 * entre deux cas. L'application n'a aucune raison de l'appeler.
 */
export function resetKnowledge(): void {
  holder.byLang = null;
}
