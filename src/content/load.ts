/**
 * Chargement du contenu privé — AD-2.
 *
 * Une seule lecture disque, au démarrage, puis un objet **gelé** : aucune
 * requête ne relit `CONTENT_DIR`. Un contenu invalide arrête le démarrage, il
 * ne produit jamais une page dégradée ni une réponse approximative.
 *
 * Les anomalies sont **agrégées** : corriger un fichier de contenu par
 * redémarrages successifs, une erreur à la fois, est le genre de détail qui
 * décourage la mise à jour. Le chargement rapporte tout ce qui ne va pas en une
 * fois, fichier et ligne à l'appui.
 *
 * Le français fait foi : une entrée anglaise sans équivalent français est
 * orpheline — sa clé de citation ne désigne rien dans la langue source, donc le
 * démarrage échoue. L'inverse est toléré : une traduction peut être en retard.
 */
// `turbopackIgnore` sur chaque accès disque : `CONTENT_DIR` est **hors** du
// projet par construction (AD-2). Sans cette annotation, Turbopack conclut de
// l'analyse statique qu'il doit tracer tout le dépôt et recopie les sources, les
// tests et les fixtures dans `.next/standalone` — 22 Mo de trop sur le VPS.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {LineCounter, parseDocument} from 'yaml';
import {buildProjections, type AgentProjection, type DisplayProjection} from './projections';
import {parseQaFile, type QaEntry} from './qa-parser';
import {cvSchema, LANGS, type CvDocument, type Lang} from './schema';

export const CV_FILE = 'cv.yaml';
export const QA_FILES: Record<Lang, string> = {fr: 'qa.fr.md', en: 'qa.en.md'};

/** Anomalie de contenu : de quoi corriger sans avoir à chercher où. */
export type ContentIssue = {
  readonly file: string;
  readonly line?: number;
  readonly entry?: string;
  readonly field?: string;
  readonly message: string;
};

/**
 * Types d'image acceptés pour la photo. Liste blanche : une extension inconnue
 * vaut « pas de photo » plutôt qu'un `application/octet-stream` que le
 * navigateur refuserait d'afficher — et qu'un fichier arbitraire de
 * `CONTENT_DIR` servi sous un type deviné.
 */
const PHOTO_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

/**
 * La photo, telle que seule la couche `content` la connaît — lue **une fois**,
 * au chargement, comme tout le reste du contenu (AD-2). La route ne rouvre
 * jamais le disque : ce qu'elle sert est ce qui a été validé au démarrage, et
 * publier une nouvelle photo demande un redémarrage, comme pour `cv.yaml`.
 */
export type PhotoFile = {
  /** Chemin absolu sous `CONTENT_DIR`. Ne sort d'aucune projection (AD-8). */
  readonly path: string;
  readonly mime: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /**
   * Condensé des octets : de quoi répondre `304`, et stable d'un déploiement
   * à l'autre — une date de modification changerait à chaque copie.
   */
  readonly etag: string;
};

/**
 * Au-delà, ce n'est plus une photo de CV. La limite protège la mémoire du
 * processus, qui garde les octets pour toute sa durée de vie.
 */
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;

/** Contenu chargé, validé, projeté et gelé. */
export type Content = {
  readonly dir: string;
  readonly cv: {
    readonly display: Readonly<Record<Lang, DisplayProjection>>;
    readonly agent: Readonly<Record<Lang, AgentProjection>>;
  };
  readonly qa: Readonly<Record<Lang, readonly QaEntry[]>>;
  readonly byId: Readonly<Record<Lang, Readonly<Record<string, QaEntry>>>>;
  /**
   * Ce que `cv.yaml` contient et qu'**aucune projection ne porte** (AD-8), mais
   * que le serveur doit tout de même pouvoir servir sur geste explicite : le
   * chemin de la photo, le numéro et le courriel, les coordonnées des références.
   *
   * Séparé de `cv` exprès. `cv` est ce qui sort ; `restricted` est ce qui ne
   * sort que par une route nommée, jamais par le rendu d'une page. Rien ici ne
   * doit être passé à un composant.
   */
  readonly restricted: {
    readonly photo: PhotoFile | null;
    readonly telephone: string | null;
    /** Hors de `display` seulement : la projection `agent` le porte (AD-8). */
    readonly email: string;
    /** Par identifiant de référence ; `null` pour une coordonnée absente. */
    readonly references: Readonly<Record<string, ReferenceContact>>;
  };
};

/** Les coordonnées d'un tiers — servies par `/api/references/<id>/contact`, jamais rendues. */
export type ReferenceContact = {
  readonly telephone: string | null;
  readonly email: string | null;
};

export type LoadResult = {readonly content: Content; readonly warnings: readonly ContentIssue[]};

/** Échec de chargement portant **toutes** les anomalies, pas la première. */
export class ContentError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(dir: string, issues: readonly ContentIssue[]) {
    super(
      `Contenu invalide dans ${dir} :\n${issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n')}`
    );
    this.name = 'ContentError';
    this.issues = issues;
  }
}

/** `qa.fr.md:41 [ia-08] — marqueur inconnu` : lisible dans un journal NSSM. */
export function formatIssue(issue: ContentIssue): string {
  const place = issue.line === undefined ? issue.file : `${issue.file}:${issue.line}`;
  const subject = issue.entry ?? issue.field;
  return subject === undefined
    ? `${place} — ${issue.message}`
    : `${place} [${subject}] — ${issue.message}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Clés présentes dans le fichier mais absentes du schéma. Zod les retire
 * silencieusement ; la différence entre le brut et le validé les révèle, sans
 * qu'aucune liste de champs connus ait besoin d'exister une seconde fois.
 */
function unknownKeys(raw: unknown, parsed: unknown, path: string[] = [], found: string[] = []) {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((item, index) => unknownKeys(item, parsed[index], [...path, String(index)], found));
    return found;
  }
  if (isPlainObject(raw) && isPlainObject(parsed)) {
    for (const key of Object.keys(raw)) {
      if (key in parsed) unknownKeys(raw[key], parsed[key], [...path, key], found);
      else found.push([...path, key].join('.'));
    }
  }
  return found;
}

/**
 * Index par identifiant, **sans prototype**. Les clés viendront de citations
 * produites par le modèle : sur un objet ordinaire, `toString` ou `constructor`
 * rendraient une valeur héritée que le type déclare pourtant être une entrée.
 */
function index(entries: readonly QaEntry[]): Record<string, QaEntry> {
  const byId = Object.create(null) as Record<string, QaEntry>;
  for (const entry of entries) byId[entry.id] = entry;
  return byId;
}

/**
 * Gel récursif : le contenu est en lecture seule pour tout le reste du site.
 * Les octets de la photo font exception par nécessité — un tableau typé ne se
 * gèle pas (`TypeError`) ; c'est `restricted`, pas une projection, et sa
 * référence, elle, est gelée avec l'objet qui la porte.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return value;
}

/** Le chemin reste-t-il sous `CONTENT_DIR` ? Une remontée est refusée. */
function insideContentDir(dir: string, relative: string): string | null {
  const root = resolve(dir);
  const target = resolve(root, relative);
  return target === root || target.startsWith(root + sep) ? target : null;
}

type YamlOutcome =
  | {ok: true; cv: CvDocument; unknown: string[]}
  | {ok: false; issues: ContentIssue[]};

/** Analyse et valide `cv.yaml`, en rattachant chaque anomalie à sa ligne. */
function readCv(text: string): YamlOutcome {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {lineCounter});

  if (document.errors.length > 0) {
    return {
      ok: false,
      issues: document.errors.map((error) => ({
        file: CV_FILE,
        line: error.linePos?.[0]?.line,
        message: `YAML illisible : ${error.message.split('\n')[0]}`
      }))
    };
  }

  const raw: unknown = document.toJS();
  const result = cvSchema.safeParse(raw);

  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => {
        const path = issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === 'string' || typeof segment === 'number'
        );
        return {
          file: CV_FILE,
          line: lineOf(document, lineCounter, path),
          field: path.length > 0 ? path.join('.') : undefined,
          message: issue.message
        };
      })
    };
  }

  return {ok: true, cv: result.data, unknown: unknownKeys(raw, result.data)};
}

/** Ligne du nœud désigné, ou de son parent si la clé manque tout à fait. */
function lineOf(
  document: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  path: readonly (string | number)[]
): number | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    try {
      const node: unknown = depth === 0 ? document.contents : document.getIn(path.slice(0, depth), true);
      const range = (node as {range?: [number, number, number]} | null)?.range;
      if (range) return lineCounter.linePos(range[0]).line;
    } catch {
      // Chemin inatteignable dans l'arbre YAML : on remonte d'un cran.
    }
  }
  return undefined;
}

export type LoadOptions = {
  /** Injecté par les tests : l'âge projeté ne doit pas dépendre du jour. */
  readonly now?: Date;
};

/**
 * Charge, valide, projette et gèle le contenu de `dir`.
 * Lève une `ContentError` portant toutes les anomalies, ou rend le contenu et
 * la liste des avertissements — au appelant de les journaliser.
 */
export function loadContent(dir: string, options: LoadOptions = {}): LoadResult {
  const errors: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];

  const cvPath = resolve(dir, CV_FILE);
  if (!existsSync(/*turbopackIgnore: true*/ cvPath)) {
    throw new ContentError(dir, [
      {file: CV_FILE, message: `fichier requis absent (attendu dans ${resolve(dir)})`}
    ]);
  }
  const frPath = resolve(dir, QA_FILES.fr);
  if (!existsSync(/*turbopackIgnore: true*/ frPath)) {
    throw new ContentError(dir, [
      {file: QA_FILES.fr, message: `fichier requis absent (attendu dans ${resolve(dir)})`}
    ]);
  }

  const cvOutcome = readCv(readFileSync(/*turbopackIgnore: true*/ cvPath, 'utf8'));
  if (!cvOutcome.ok) throw new ContentError(dir, cvOutcome.issues);

  for (const field of cvOutcome.unknown) {
    warnings.push({file: CV_FILE, field, message: 'champ inconnu du schéma : ignoré, jamais projeté'});
  }

  // Photo : seule sa présence est projetée, jamais son chemin (AD-8). Le chemin
  // reste ici, dans `restricted`, où seule la route `/api/photo` ira le chercher.
  let photoFile: PhotoFile | null = null;
  const photo = cvOutcome.cv.identite.photo;
  if (photo === undefined) {
    warnings.push({
      file: CV_FILE,
      field: 'identite.photo',
      message: 'champ absent : la projection est servie sans photo'
    });
  } else {
    const target = insideContentDir(dir, photo);
    const mime = PHOTO_TYPES[extname(photo).toLowerCase()];
    if (target === null) {
      warnings.push({
        file: CV_FILE,
        field: 'identite.photo',
        message: 'chemin sortant de CONTENT_DIR : photo ignorée'
      });
    } else if (!existsSync(/*turbopackIgnore: true*/ target)) {
      warnings.push({
        file: CV_FILE,
        field: 'identite.photo',
        message: 'fichier introuvable : la projection est servie sans photo'
      });
    } else if (mime === undefined) {
      warnings.push({
        file: CV_FILE,
        field: 'identite.photo',
        message: `type d'image inconnu (${extname(photo) || 'sans extension'}) : la projection est servie sans photo`
      });
    } else {
      // Un fichier illisible — droits, répertoire portant une extension
      // d'image — ou déraisonnable vaut un avertissement, jamais un arrêt :
      // la page se rend sans photo, comme pour un champ absent.
      let bytes: Uint8Array<ArrayBuffer> | null = null;
      try {
        bytes = new Uint8Array(readFileSync(/*turbopackIgnore: true*/ target));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'erreur de lecture';
        warnings.push({
          file: CV_FILE,
          field: 'identite.photo',
          message: `fichier illisible (${code}) : la projection est servie sans photo`
        });
      }
      if (bytes !== null && bytes.byteLength > PHOTO_MAX_BYTES) {
        warnings.push({
          file: CV_FILE,
          field: 'identite.photo',
          message: `fichier trop lourd (${Math.round(bytes.byteLength / 1048576)} Mo, maximum ${PHOTO_MAX_BYTES / 1048576}) : la projection est servie sans photo`
        });
        bytes = null;
      }
      if (bytes !== null) {
        photoFile = {
          path: target,
          mime,
          bytes,
          etag: `"${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`
        };
      }
    }
  }
  const hasPhoto = photoFile !== null;

  const qa: Record<Lang, QaEntry[]> = {fr: [], en: []};
  /** Le fichier est-il là ? Un fichier présent mais muet n'est pas un fichier absent. */
  const present: Record<Lang, boolean> = {fr: true, en: false};

  for (const lang of LANGS) {
    const file = QA_FILES[lang];
    const path = resolve(dir, file);
    if (!existsSync(/*turbopackIgnore: true*/ path)) {
      warnings.push({file, message: 'fichier absent : le corpus de cette langue reste vide'});
      continue;
    }
    present[lang] = true;
    const parsed = parseQaFile(readFileSync(/*turbopackIgnore: true*/ path, 'utf8'), lang);
    for (const issue of parsed.errors) {
      errors.push({
        file,
        line: issue.ligne,
        ...(issue.entree === undefined ? {} : {entry: issue.entree}),
        message: issue.message
      });
    }
    qa[lang] = parsed.entries;
  }

  // Le français fait foi : une entrée anglaise sans source française est orpheline.
  const frenchIds = new Set(qa.fr.map((entry) => entry.id));
  for (const entry of qa.en) {
    if (!frenchIds.has(entry.id)) {
      errors.push({
        file: QA_FILES.en,
        line: entry.ligne,
        entry: entry.id,
        message: 'entrée orpheline : aucun équivalent dans qa.fr.md, qui fait foi'
      });
    }
  }

  // Un corpus français vide n'est pas un corpus : le site n'aurait rien à dire,
  // et chaque question tomberait dans le refus. C'est une erreur, pas un détail.
  if (qa.fr.length === 0) {
    errors.push({
      file: QA_FILES.fr,
      message: 'aucune entrée reconnue : le corpus de référence est vide'
    });
  }

  if (errors.length > 0) throw new ContentError(dir, errors);

  // Traduction en retard : toléré, jamais silencieux (AD-5). La garde porte sur
  // la **présence du fichier**, pas sur le nombre d'entrées : un qa.en.md présent
  // mais vide, c'est 232 traductions manquantes, pas zéro.
  if (present.en) {
    const englishIds = new Set(qa.en.map((entry) => entry.id));
    const missing = qa.fr.filter((entry) => !englishIds.has(entry.id)).map((entry) => entry.id);
    if (missing.length > 0) {
      warnings.push({
        file: QA_FILES.en,
        message: `traduction en retard pour ${missing.length} entrée(s) : ${missing.join(', ')}`
      });
    }
  }

  // Entrées vides : conservées, ni indexables ni citables, mais annoncées.
  for (const lang of LANGS) {
    const empty = qa[lang].filter((entry) => entry.statut === 'vide').map((entry) => entry.id);
    if (empty.length > 0) {
      warnings.push({
        file: QA_FILES[lang],
        message: `${empty.length} entrée(s) au corps vide, ni indexées ni citables : ${empty.join(', ')}`
      });
    }
  }

  const projections = {
    fr: buildProjections(cvOutcome.cv, 'fr', {hasPhoto, ...(options.now ? {now: options.now} : {})}),
    en: buildProjections(cvOutcome.cv, 'en', {hasPhoto, ...(options.now ? {now: options.now} : {})})
  };

  // Un champ bilingue sans version anglaise sert du français à un modèle à qui
  // l'on demande de répondre en anglais. Toléré, jamais silencieux — même règle
  // que pour les corpus Q/R (AD-5).
  for (const lang of LANGS) {
    const missing = projections[lang].fallbacks;
    if (missing.length > 0) {
      warnings.push({
        file: CV_FILE,
        message: `${missing.length} champ(s) sans version « ${lang} », servis dans l'autre langue : ${missing.join(', ')}`
      });
    }
  }

  // `Object.create(null)` : les identifiants viendront de clés de citation
  // produites par le modèle. Sur un objet ordinaire, `qaEntry('fr', 'toString')`
  // rendrait une fonction héritée, typée `QaEntry`.
  const byId = {
    fr: index(qa.fr),
    en: index(qa.en)
  };

  const content = deepFreeze<Content>({
    dir: resolve(dir),
    cv: {
      display: {fr: projections.fr.display, en: projections.en.display},
      agent: {fr: projections.fr.agent, en: projections.en.agent}
    },
    qa,
    byId,
    // Un numéro fait d'espaces n'en est pas un : la route répondra `404`,
    // pas un lien `tel:` vide. Même règle pour les coordonnées des références.
    restricted: {
      photo: photoFile,
      telephone: cvOutcome.cv.contact.telephone?.trim() || null,
      email: cvOutcome.cv.contact.email,
      references: Object.freeze(
        Object.fromEntries(
          (cvOutcome.cv.references ?? []).map((entry) => [
            entry.id,
            {telephone: entry.telephone?.trim() || null, email: entry.email?.trim() || null}
          ])
        )
      )
    }
  });

  return {content, warnings: Object.freeze(warnings)};
}

/** Une ligne JSON par avertissement sur stdout — convention de journalisation. */
export function logContentWarnings(warnings: readonly ContentIssue[]): void {
  for (const warning of warnings) {
    console.warn(
      JSON.stringify({level: 'warn', event: 'content.warning', ...warning, text: formatIssue(warning)})
    );
  }
}
