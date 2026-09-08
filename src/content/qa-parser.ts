/**
 * Analyseur des fichiers `qa.*.md` — AD-2.
 *
 * La grammaire est celle du contrat : `## n. Bloc`, `#### [⭐ ]` + id entre
 * accents graves + ` — question`, `**Réponse :**`, corps Markdown libre, blocs
 * `> **Consigne à l'agent :**`.
 *
 * Deux principes gouvernent tout ce fichier :
 *
 *  1. **Le corps sort tel qu'il est entré.** Il part au modèle sans retouche
 *     (AD-3) : espaces insécables, retours forcés Markdown en fin de ligne,
 *     indentation — rien n'est normalisé dans ce qui est stocké. La
 *     normalisation ne sert qu'à *comparer* des marqueurs.
 *  2. **Ce qui n'est pas un marqueur connu est du corps.** Les seuls marqueurs
 *     sont `PRIVÉ` et `PASSE`, plus un jeton entre crochets en tête de corps.
 *     Aucune heuristique : sur un corpus de réponses de recruteur, « OUI. » ou
 *     « SQL, PHP, HTML. » sont des réponses ordinaires, pas des brouillons.
 *
 * Ce qui s'écarte de la grammaire est une **erreur** portant son numéro de
 * ligne, jamais une tolérance silencieuse : mieux vaut un démarrage refusé
 * qu'une entrée avalée sans que personne ne le sache.
 */
import type {Lang} from './schema';

/** Statuts possibles d'une entrée — `Always` de la story « contrat de contenu ». */
export const QA_STATUSES = ['normale', 'vide', 'PRIVÉ', 'PASSE'] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

/** Les seuls marqueurs de corps que le contrat définit. Liste close. */
const MARQUEURS = ['PRIVÉ', 'PASSE'] as const;
type Marqueur = (typeof MARQUEURS)[number];

/** Bloc `## n. Titre` auquel une entrée appartient. */
export type QaBlock = {
  readonly numero: number | null;
  readonly titre: string;
  readonly ligne: number;
};

/**
 * Une entrée question/réponse.
 *
 * `corps` n'existe que pour une entrée `normale` : le corps d'une entrée
 * `PRIVÉ` ne quitte jamais la couche `content`, et une entrée `vide` ou `PASSE`
 * n'en a pas à donner.
 */
export type QaEntry = {
  readonly id: string;
  /** Clé de citation `qa:<id>` — AD-4. */
  readonly source: string;
  readonly lang: Lang;
  readonly ligne: number;
  readonly question: string;
  /** Question prioritaire (⭐). Repère éditorial, sans effet fonctionnel. */
  readonly etoile: boolean;
  readonly statut: QaStatus;
  readonly corps?: string;
  /** Instruction de comportement adressée à l'agent, toujours injectée (AD-3). */
  readonly consigne: string | null;
  readonly bloc: QaBlock | null;
};

/**
 * Anomalie relevée dans un fichier.
 *
 * Fichier, ligne, identifiant — **jamais le texte du corps**. Ces messages
 * partent sur stderr, donc dans le journal du service ; le contenu, lui, reste
 * dans le fichier privé.
 */
export type QaIssue = {
  readonly ligne: number;
  readonly entree?: string;
  readonly message: string;
};

export type QaParseResult = {
  readonly entries: QaEntry[];
  readonly errors: QaIssue[];
};

/**
 * Le contrat écrit un préfixe de lettres suivi d'un nombre. Le corpus réel
 * porte des identifiants dont le préfixe contient un chiffre — un bloc consacré
 * à un employeur dont le nom en comporte un. Le préfixe admet donc les chiffres :
 * élargir la règle plutôt que renommer des entrées dont l'identifiant est déjà
 * une clé de citation stable.
 */
const ID_PATTERN = /^[a-z][a-z0-9]*-\d+$/;

const HEADING = /^(#{1,6})\s+(.*)$/;
const ENTRY_HEADING = /^(⭐️?\s+)?`([^`]+)`\s+—\s+(.+?)\s*$/;
const BLOCK_HEADING = /^(?:(\d+)\.\s*)?(.+?)\s*$/;
const ANSWER_MARKER = /^\*\*Réponse\s*:\*\*$/;
/** L'apostrophe droite **et** la typographique : un éditeur substitue l'une à l'autre. */
const CONSIGNE_MARKER = /^>\s*\*\*Consigne à l['’]agent\s*:\*\*\s*(.*)$/;
const QUOTE_LINE = /^>\s?(.*)$/;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** Clôture de bloc de code : trois marqueurs ou plus, jusqu'à trois espaces devant. */
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;

/** Espaces insécables : invisibles à la relecture, fatals à une comparaison. */
function normalizeSpaces(line: string): string {
  return line.replace(/[\u00a0\u202f]/g, ' ').trim();
}

/** `[BROUILLON]` en tête de corps — mais pas un lien Markdown `[texte](url)`. */
function looksBracketed(line: string): boolean {
  const match = /^\[([^\]\n]{1,60})\]/.exec(line);
  return match !== null && line[match[0].length] !== '(';
}

/** Retire les lignes entièrement vides en tête et en queue, et **rien d'autre**. */
function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end);
}

type OpenEntry = {
  id: string;
  ligne: number;
  question: string;
  etoile: boolean;
  bloc: QaBlock | null;
  answerLine: number | null;
  firstBodyLine: number | null;
  body: string[];
  consigne: string[];
  /** Lignes vides retenues pendant une consigne, en attendant de savoir. */
  pendingBlank: string[];
};

/**
 * Analyse un fichier `qa.*.md`. Ne lève jamais : les anomalies sont **toutes**
 * rendues d'un coup, pour qu'une correction ne se fasse pas par redémarrages
 * successifs.
 */
export function parseQaFile(text: string, lang: Lang): QaParseResult {
  // Un BOM devant le premier `####` rendrait l'entrée invisible — sans erreur,
  // donc en fabriquant un faux orphelin ou une fausse traduction manquante.
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  const entries: QaEntry[] = [];
  const errors: QaIssue[] = [];
  const seen = new Map<string, number>();

  let bloc: QaBlock | null = null;
  let open: OpenEntry | null = null;
  let inConsigne = false;
  /** Marqueur de la clôture ouverte, et sa ligne. `null` hors bloc de code. */
  let fence: {marker: string; ligne: number} | null = null;

  const fail = (ligne: number, message: string, entree?: string): void => {
    errors.push(entree === undefined ? {ligne, message} : {ligne, entree, message});
  };

  /**
   * Ferme la consigne : ce qui suit n'est plus une instruction.
   *
   * Les lignes vides retenues sont **abandonnées** : elles séparaient deux
   * paragraphes de la consigne, elles n'appartiennent pas au corps. Les verser
   * dans le corps y laisserait la trace en creux du bloc retiré.
   */
  function endConsigne(): void {
    if (!open) return;
    inConsigne = false;
    open.pendingBlank = [];
  }

  function close(): void {
    if (!open) return;
    const entry = open;
    open = null;
    inConsigne = false;

    if (entry.answerLine === null) {
      fail(entry.ligne, 'entrée sans marqueur `**Réponse :**`', entry.id);
      return;
    }

    // Le corps est conservé à l'octet près : seules les lignes entièrement vides
    // du début et de la fin disparaissent.
    const corps = trimBlankLines(entry.body).join('\n');
    const consigne = entry.consigne.join('\n').trim() || null;
    const compare = normalizeSpaces(corps).normalize('NFC');
    const first = normalizeSpaces(corps.split('\n', 1)[0] ?? '').normalize('NFC');
    // Un marqueur se corrige dans le corps : c'est là que le message pointe.
    const corpsLigne = entry.firstBodyLine ?? entry.answerLine;

    let statut: QaStatus;
    if (corps.trim().length === 0) {
      statut = 'vide';
    } else if ((MARQUEURS as readonly string[]).includes(first)) {
      if (compare !== first) {
        fail(
          corpsLigne,
          `marqueur « ${first} » suivi de texte : le corps doit valoir exactement « ${first} »`,
          entry.id
        );
        return;
      }
      statut = first as Marqueur;
    } else if (looksBracketed(first)) {
      // Le jeton lui-même n'est pas recopié : il fait partie du contenu privé.
      fail(corpsLigne, 'jeton entre crochets en tête de corps, hors du contrat', entry.id);
      return;
    } else {
      statut = 'normale';
    }

    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      fail(entry.ligne, `identifiant dupliqué (déjà défini ligne ${previous})`, entry.id);
      return;
    }
    seen.set(entry.id, entry.ligne);

    entries.push(
      Object.freeze({
        id: entry.id,
        source: `qa:${entry.id}`,
        lang,
        ligne: entry.ligne,
        question: entry.question,
        etoile: entry.etoile,
        statut,
        ...(statut === 'normale' ? {corps} : {}),
        consigne,
        bloc: entry.bloc
      })
    );
  }

  for (const [index, rawLine] of lines.entries()) {
    const ligne = index + 1;

    // ── Blocs de code ────────────────────────────────────────────────────────
    // Un corps qui illustre le format du corpus contient `####`, `---` ou
    // `**Réponse :**`. À l'intérieur d'une clôture, rien n'est de la structure.
    const fenceMatch = FENCE.exec(rawLine);
    if (fence !== null) {
      const closes =
        fenceMatch !== null &&
        fenceMatch[1]!.startsWith(fence.marker[0]!) &&
        fenceMatch[1]!.length >= fence.marker.length &&
        fenceMatch[2]!.trim() === '';
      if (closes) fence = null;
      if (open && open.answerLine !== null) {
        endConsigne();
        if (open.firstBodyLine === null && rawLine.trim() !== '') open.firstBodyLine = ligne;
        open.body.push(rawLine);
      }
      continue;
    }
    if (fenceMatch !== null && open && open.answerLine !== null) {
      fence = {marker: fenceMatch[1]!, ligne};
      endConsigne();
      if (open.firstBodyLine === null) open.firstBodyLine = ligne;
      open.body.push(rawLine);
      continue;
    }
    if (fenceMatch !== null) {
      // Hors corps d'entrée : la clôture protège quand même le texte de la prose
      // d'introduction, où le contrat lui-même est cité en exemple.
      fence = {marker: fenceMatch[1]!, ligne};
      continue;
    }

    const line = normalizeSpaces(rawLine);
    const heading = HEADING.exec(rawLine.trimEnd());

    if (heading) {
      const level = heading[1]!.length;
      const rest = heading[2]!;

      if (level === 4) {
        close();
        const parsed = ENTRY_HEADING.exec(rest);
        if (!parsed) {
          fail(ligne, "en-tête d'entrée non conforme au contrat de contenu");
          continue;
        }
        const id = parsed[2]!;
        if (!ID_PATTERN.test(id)) {
          fail(ligne, `identifiant « ${id} » hors format attendu (préfixe-nombre)`);
          continue;
        }
        open = {
          id,
          ligne,
          question: parsed[3]!,
          etoile: parsed[1] !== undefined,
          bloc,
          answerLine: null,
          firstBodyLine: null,
          body: [],
          consigne: [],
          pendingBlank: []
        };
        continue;
      }

      close();

      if (level === 2) {
        const parsed = BLOCK_HEADING.exec(rest)!;
        bloc = Object.freeze({
          numero: parsed[1] === undefined ? null : Number(parsed[1]),
          titre: parsed[2]!,
          ligne
        });
        continue;
      }

      if (level === 1) {
        bloc = null;
        continue;
      }

      fail(ligne, `titre de niveau ${level} inattendu : seuls #, ## et #### sont prévus`);
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      close();
      continue;
    }

    if (!open) continue;

    if (open.answerLine === null) {
      if (line === '') continue;
      if (ANSWER_MARKER.test(line)) {
        open.answerLine = ligne;
        continue;
      }
      fail(ligne, 'ligne inattendue avant le marqueur `**Réponse :**`', open.id);
      continue;
    }

    if (ANSWER_MARKER.test(line)) {
      fail(ligne, 'second marqueur `**Réponse :**` dans la même entrée', open.id);
      continue;
    }

    const consigne = CONSIGNE_MARKER.exec(line);
    if (consigne) {
      endConsigne();
      inConsigne = true;
      if (open.consigne.length > 0) open.consigne.push('');
      if (consigne[1]!.trim() !== '') open.consigne.push(consigne[1]!.trim());
      continue;
    }

    if (inConsigne) {
      const quoted = QUOTE_LINE.exec(line);
      if (quoted) {
        // Une ligne vide au milieu d'une consigne ne la termine pas : elle en
        // sépare deux paragraphes. Sans quoi la suite de l'instruction serait
        // servie comme réponse.
        if (open.pendingBlank.length > 0) open.consigne.push('');
        open.pendingBlank = [];
        open.consigne.push(quoted[1]!.trim());
        continue;
      }
      if (line === '') {
        open.pendingBlank.push(rawLine);
        continue;
      }
      endConsigne();
    }

    if (open.firstBodyLine === null && rawLine.trim() !== '') open.firstBodyLine = ligne;
    open.body.push(rawLine);
  }

  if (fence !== null) {
    fail(fence.ligne, 'bloc de code ouvert et jamais refermé : la suite du fichier est avalée');
  }
  close();
  return {entries, errors};
}
