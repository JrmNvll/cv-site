/**
 * Le schéma du jeu de tests adverses — AD-12.
 *
 * Le jeu réel vit dans le dépôt privé (`CONTENT_DIR/tests/adversarial.yaml`,
 * prévu par AD-2) ; ce dépôt public n'en porte que la forme, et un mini-jeu
 * sur la fixture. Un fichier invalide arrête le runner **avant tout appel** :
 * chaque appel réel coûte de l'argent, et un cas mal écrit ne prouverait rien.
 *
 * Ce module ne dépend que de `zod` : il est importé par le runner (Vitest),
 * par le mini-jeu, et par `scripts/check-content.mjs` sous Node seul — sans
 * alias `@/`, sans `src/env.ts`, sans syntaxe que Node ne sait pas effacer.
 *
 * Les cinq attentes :
 *  - `covered` : une question que le dossier couvre — `done`, des sources
 *    non vides et, si `sources_any` est donné, l'une d'elles ;
 *  - `refusal` : hors périmètre ou détournement — `done`, **aucune** source,
 *    et l'une des formulations de `contains` ;
 *  - `redirect` : un renvoi — vers la section contact, vers la page des
 *    mentions — `done`, l'une des formulations de `contains`, et des sources
 *    toutes dans `sources_allowed` (une liste, vide s'il le faut) ;
 *  - `private` : une question visant une entrée `PRIVÉ` — l'une des
 *    formulations de `contains` (tirée de la consigne ou d'une entrée
 *    `sys-*`), aucune sentinelle de `forbid` ;
 *  - `match` : une annonce (`kind: match`) — `done`, la structure d'AD-17,
 *    aucune sentinelle de `forbid`.
 *
 * Pour **tout** échange `done`, `citation_ok` doit être vrai : le journal ne
 * garde que les sources valides, et une entrée `PRIVÉ` ou inventée déclarée
 * par le modèle n'y laisse que cette trace.
 *
 * `contains` et `forbid` sont comparés au texte **normalisé** (`comparable`) :
 * apostrophes unifiées, blancs réduits, diacritiques repliés, minuscules —
 * les motifs s'écrivent donc sans accent ni majuscule, et `forbid` est
 * compilé avec `iu`. `\b` y est refusé : il est ASCII en JavaScript, « é »
 * est une frontière pour lui — on borne par `(?<!\p{L})` et `(?!\p{L})`.
 * Ni cinq chiffres consécutifs ni `@` : des sentinelles sans donnée réelle.
 *
 * `group` : les cas d'un même groupe partagent visiteur et session, dans
 * l'ordre du fichier ; dix au plus (le limiteur par visiteur), une seule
 * langue ; soixante cas au plus dans le jeu (le limiteur du site).
 */
import {z} from 'zod';

export const CASE_LANGS = ['fr', 'en'] as const;
export const CASE_KINDS = ['chat', 'match'] as const;
export const EXPECTATIONS = ['covered', 'refusal', 'redirect', 'private', 'match'] as const;

export type CaseLang = (typeof CASE_LANGS)[number];
export type CaseKind = (typeof CASE_KINDS)[number];
export type Expectation = (typeof EXPECTATIONS)[number];

/** Les bornes du site : dix questions par visiteur et par quart d'heure, soixante par heure pour tous. */
export const GROUP_MAX_CASES = 10;
export const SUITE_MAX_CASES = 60;
/** Les bornes d'une question et d'une annonce (`src/agent/pricing.ts`), recopiées : ce module ne peut pas les importer. */
export const MAX_QUESTION_CHARS = 1000;
export const MAX_AD_CHARS = 8000;

/** Un identifiant de cas ou de groupe : minuscules, chiffres, tirets — lisible dans un rapport et dans `ADVERSARIAL_ONLY`. */
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;

/** Une clé de citation, telle que `knowledge` les valide : `qa:<id>` ou `cv:<chemin>`. */
const SOURCE_KEY = /^(qa|cv):[A-Za-z0-9_.-]+$/;

/**
 * Les caractères invisibles qu'un `trim()` ne voit pas — les mêmes que
 * `src/agent/index.ts` retire avant de mesurer une question : espaces de
 * largeur nulle, antiliants, marque d'ordre des octets. Construits par point
 * de code plutôt qu'écrits en échappements.
 */
const INVISIBLE = new RegExp(
  `[${String.fromCodePoint(0x200b)}-${String.fromCodePoint(0x200d)}${String.fromCodePoint(0x2060)}${String.fromCodePoint(0xfeff)}]`,
  'g'
);

/** Ce que l'agent mesurera : sans les invisibles ni les blancs des deux bouts. */
export function measuredInput(value: string): string {
  return value.replace(INVISIBLE, '').trim();
}

/**
 * La forme comparable d'un texte, la même pour la réponse, `contains` et
 * `forbid` : NFD sans les marques (« é » → « e »), apostrophes typographiques
 * et accents graves unifiés en `'`, blancs réduits à une espace, minuscules.
 */
export function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Les fragments de `contains` qui ne sont sous-chaîne d'aucun des textes donnés, une fois tout normalisé. */
export function missingWordings(wordings: readonly string[], haystacks: readonly string[]): string[] {
  const folded = haystacks.map(comparable);
  return wordings.filter((wording) => {
    const needle = comparable(wording);
    return !folded.some((text) => text.includes(needle));
  });
}

/** Pourquoi un motif ou une formulation est refusé — `null` s'il est acceptable. */
function patternRefusal(value: string): string | null {
  if (value.includes('\\b')) {
    return '`\\b` est ASCII en JavaScript (« é » est une frontière pour lui) ; borner par `(?<!\\p{L})` et `(?!\\p{L})`';
  }
  if (/\d{5}/.test(value)) return 'cinq chiffres consécutifs : une sentinelle ne porte aucune donnée réelle';
  if (value.includes('@')) return '`@` : une sentinelle ne porte aucune adresse';
  return null;
}

function isRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'iu');
    return true;
  } catch {
    return false;
  }
}

const forbidPattern = z
  .string()
  .min(1, 'un motif `forbid` ne peut pas être vide')
  .refine(isRegex, {error: 'motif `forbid` illisible : ce nʼest pas une expression régulière valide (drapeaux `iu`)'})
  .superRefine((value, ctx) => {
    const refusal = patternRefusal(value);
    if (refusal !== null) ctx.addIssue({code: 'custom', message: refusal});
  });

const wording = z
  .string()
  .min(1, 'une formulation `contains` ne peut pas être vide')
  .superRefine((value, ctx) => {
    const refusal = patternRefusal(value);
    if (refusal !== null) ctx.addIssue({code: 'custom', message: refusal});
  });

export const caseSchema = z
  .strictObject({
    id: z.string().regex(IDENTIFIER, '`id` : minuscules, chiffres et tirets, sans espace'),
    lang: z.enum(CASE_LANGS, {error: '`lang` doit être `fr` ou `en`'}),
    kind: z.enum(CASE_KINDS, {error: '`kind` doit être `chat` ou `match`'}),
    input: z.string({error: '`input` doit être un texte'}),
    expect: z.enum(EXPECTATIONS, {
      error: '`expect` doit être `covered`, `refusal`, `redirect`, `private` ou `match`'
    }),
    group: z.string().regex(IDENTIFIER, '`group` : minuscules, chiffres et tirets, sans espace').optional(),
    sources_any: z
      .array(z.string().regex(SOURCE_KEY, 'une source attendue est une clé `qa:<id>` ou `cv:<chemin>`'))
      .min(1, '`sources_any` ne peut pas être vide')
      .optional(),
    sources_allowed: z
      .array(z.string().regex(SOURCE_KEY, 'une source tolérée est une clé `qa:<id>` ou `cv:<chemin>`'))
      .optional(),
    contains: z.union([wording, z.array(wording).min(1, '`contains` ne peut pas être vide')]).optional(),
    forbid: z.array(forbidPattern).min(1, '`forbid` ne peut pas être vide').optional()
  })
  .superRefine((value, ctx) => {
    const issue = (message: string, path: string[] = []) => ctx.addIssue({code: 'custom', message, path});
    if ((value.expect === 'match') !== (value.kind === 'match')) {
      issue('`expect: match` et `kind: match` vont ensemble — une annonce est évaluée, une question est posée', ['kind']);
    }
    if ((value.expect === 'refusal' || value.expect === 'redirect' || value.expect === 'private') && value.contains === undefined) {
      issue(
        `\`expect: ${value.expect}\` exige \`contains\` : la formulation attendue, tirée des entrées qa:sys-* ou de la consigne`,
        ['contains']
      );
    }
    if (value.sources_any !== undefined && value.expect !== 'covered') {
      issue('`sources_any` ne vaut que pour `expect: covered`', ['sources_any']);
    }
    if (value.sources_allowed !== undefined && value.expect !== 'redirect') {
      issue('`sources_allowed` ne vaut que pour `expect: redirect`', ['sources_allowed']);
    }
    if (value.expect === 'redirect' && value.sources_allowed === undefined) {
      issue("`expect: redirect` exige `sources_allowed` : la liste des sources tolérées, vide s'il le faut", ['sources_allowed']);
    }
  });

export const suiteSchema = z.strictObject({
  cases: z.array(caseSchema).min(1, 'le jeu ne contient aucun cas')
});

export type AdversarialCase = z.infer<typeof caseSchema>;
export type AdversarialSuite = z.infer<typeof suiteSchema>;

/** Les formulations attendues d'un cas, toujours en liste. */
export function wordingsOf(entry: AdversarialCase): readonly string[] {
  if (entry.contains === undefined) return [];
  return typeof entry.contains === 'string' ? [entry.contains] : entry.contains;
}

type RawCase = {
  readonly id?: unknown;
  readonly lang?: unknown;
  readonly kind?: unknown;
  readonly input?: unknown;
  readonly group?: unknown;
};

/** Le nom d'un cas dans un message : son `id` s'il se lit, sa position sinon. */
function caseLabel(entry: RawCase | undefined, index: number): string {
  return typeof entry?.id === 'string' && entry.id !== '' ? entry.id : `#${index + 1}`;
}

/**
 * Les contrôles **hors Zod** — pour qu'ils soient rapportés même quand un cas
 * est mal formé par ailleurs : les identifiants en double, la longueur de
 * l'entrée (qui dépend de `kind`), la taille du jeu, la taille et la langue
 * de chaque groupe.
 */
function suiteIssues(cases: readonly RawCase[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, {size: number; langs: Set<string>}>();
  cases.forEach((entry, index) => {
    const label = caseLabel(entry, index);
    if (typeof entry?.id === 'string' && entry.id !== '') {
      if (seen.has(entry.id)) issues.push(`cas ${label}, champ id : identifiant en double : ${entry.id}`);
      seen.add(entry.id);
    }
    if (typeof entry?.input === 'string') {
      const max = entry.kind === 'match' ? MAX_AD_CHARS : MAX_QUESTION_CHARS;
      const length = measuredInput(entry.input).length;
      if (length === 0) issues.push(`cas ${label}, champ input : \`input\` ne peut pas être vide`);
      else if (length > max) {
        issues.push(`cas ${label}, champ input : \`input\` dépasse ${max} caractères (${length}) : l'agent le refuserait`);
      }
    }
    if (typeof entry?.group === 'string' && entry.group !== '') {
      const group = groups.get(entry.group) ?? {size: 0, langs: new Set<string>()};
      group.size += 1;
      if (typeof entry.lang === 'string') group.langs.add(entry.lang);
      groups.set(entry.group, group);
    }
  });
  if (cases.length > SUITE_MAX_CASES) {
    issues.push(
      `(racine) : ${cases.length} cas, ${SUITE_MAX_CASES} au plus — le limiteur du site n'en laisse pas passer plus par heure`
    );
  }
  for (const [name, group] of groups) {
    if (group.size > GROUP_MAX_CASES) {
      issues.push(
        `groupe ${name} : ${group.size} cas, ${GROUP_MAX_CASES} au plus — le limiteur par visiteur n'en laisse pas passer plus`
      );
    }
    if (group.langs.size > 1) {
      issues.push(`groupe ${name} : une seule langue par groupe (${[...group.langs].join(', ')}) — une session a une langue`);
    }
  }
  return issues;
}

/**
 * Valide un document déjà lu (YAML analysé). Lève une `Error` dont le message
 * nomme chaque cas fautif — par son `id` quand il est lisible, par sa position
 * sinon — et chaque champ : c'est ce que le runner écrit avant de s'arrêter,
 * sans avoir rien appelé.
 */
export function parseSuite(raw: unknown): AdversarialSuite {
  const result = suiteSchema.safeParse(raw);
  const cases = Array.isArray((raw as {cases?: unknown} | null)?.cases)
    ? ((raw as {cases: unknown[]}).cases as RawCase[])
    : [];

  const lines: string[] = [];
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.map(String);
      let where = '(racine)';
      if (path[0] === 'cases' && path[1] !== undefined) {
        const index = Number(path[1]);
        const field = path.slice(2).join('.');
        const label = caseLabel(cases[index], index);
        where = field === '' ? `cas ${label}` : `cas ${label}, champ ${field}`;
      } else if (path.length > 0) {
        where = path.join('.');
      }
      lines.push(`${where} : ${issue.message}`);
    }
  }
  lines.push(...suiteIssues(cases));

  if (lines.length > 0) {
    throw new Error(
      `Jeu de tests adverses invalide — ${lines.length} anomalie(s) :\n${lines.map((line) => `  - ${line}`).join('\n')}`
    );
  }
  return result.data!;
}
