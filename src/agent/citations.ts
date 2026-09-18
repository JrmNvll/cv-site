/**
 * Le bloc `<sources>` et les marques `[qa:…]` / `[cv:…]` — AD-4, AD-16 et
 * AD-17 : retirés **côté serveur**, jamais vus du navigateur, contrôlés a
 * posteriori, résultat journalisé.
 *
 * Trois parties :
 *
 *  1. **Le filtre de flux.** Le modèle écrit par morceaux, et le bloc peut
 *     arriver fragmenté — `<sour` puis `ces>…`, ou un caractère à la fois. Le
 *     filtre retient le texte depuis un `<` non résolu tant qu'il peut encore
 *     être le début de `<sources>`, et relâche tout ce qui ne l'est pas : un
 *     `<` suivi d'autre chose, une balise inconnue, une comparaison « a < b ».
 *     Même automate pour les marques du mode évaluation : un `[` est tenu tant
 *     qu'il peut ouvrir `[qa:` ou `[cv:` ; confirmé, tout ce qui suit jusqu'au
 *     `]` est capturé avec sa **position dans le texte relâché** — de quoi
 *     savoir sous quel titre la marque tombait — et rien n'en sort ; tout
 *     autre `[` (« [voir CV] ») est relâché avec son texte. Rien n'est retenu
 *     plus longtemps que nécessaire.
 *  2. **L'extraction et le contrôle d'une question** (`checkCitations`). Une
 *     fois le flux fini, les identifiants déclarés dans le bloc sont lus, mis
 *     en forme, dédoublonnés, puis chacun est vérifié contre la connaissance
 *     de la langue courante. Une source invalide est retirée et `ok` vaut
 *     faux ; sans bloc du tout — un refus — `ok` vaut vrai.
 *  3. **Le contrôle d'une évaluation** (`checkMatchCitations`). La structure
 *     en quatre parties, chaque titre en gras seul sur sa ligne et dans
 *     l'ordre ; une marque au moins par point des deux premières parties ;
 *     aucune sous les écarts ; toute marque et toute source du bloc valides.
 *     Les sources sont l'union des marques valides et du bloc valide ; `ok`
 *     dit si tout y est, et `reasons` pourquoi pas — jamais le texte.
 *
 * Aucune dépendance : lisible et testable seul, caractère par caractère.
 */

export const SOURCES_OPEN = '<sources>';
export const SOURCES_CLOSE = '</sources>';
/** Les balises se reconnaissent **sans tenir compte de la casse** : `<Sources>`, `<SOURCES>` sont le bloc. */
const OPEN_TAG = /<sources>/i;
const CLOSE_TAG = /<\/sources>/i;
/** L'ouverture d'une marque : `[qa:` ou `[cv:`, casse ignorée elle aussi. */
const MARK_OPEN = /\[(qa|cv):/i;
const MARK_PREFIXES = ['[qa:', '[cv:'] as const;
/** Le plus long préfixe strict d'une balise ou d'une marque qu'un texte peut retenir en attente. */
const LONGEST_PENDING = SOURCES_CLOSE.length - 1;
/**
 * Au-delà de tant de caractères après `[qa:` sans `]`, ce n'est plus un
 * identifiant : la marque est close, malformée — ces caractères-là ne sortent
 * pas, le texte reprend à la borne — que le `]` arrive plus loin, dans le même
 * morceau ou jamais. La borne s'applique au même endroit quel que soit le
 * découpage du flux : un morceau ou un caractère à la fois, le même texte sort.
 */
export const MARK_MAX_CHARS = 120;

/** Une clé de citation bien formée : `qa:<id>` ou `cv:<chemin>` (AD-4). */
const SOURCE_KEY = /^(?:qa|cv):[a-z0-9][a-z0-9_.-]*$/;

/** Une marque capturée : ce qu'elle désigne, et où elle était. */
export type Mark = {
  /** `qa:<id>` ou `cv:<chemin>`, tel qu'écrit après nettoyage — la validité se juge après. */
  readonly id: string;
  /** L'offset, dans le texte relâché, de l'endroit où la marque se trouvait. */
  readonly at: number;
};

export type SourcesFilter = {
  /** Reçoit un morceau du flux ; rend ce qui peut être transmis maintenant. */
  push(chunk: string): string;
  /** Le flux est fini : rend ce qui était retenu et n'est pas le bloc ni une marque. */
  flush(): string;
  /** Le contenu du bloc `<sources>` capturé, ou `null` s'il n'y en a pas eu. */
  block(): string | null;
  /** Les marques capturées, dans l'ordre du flux, avec leur position. */
  marks(): readonly Mark[];
  /** Tout le texte relâché jusqu'ici, bout à bout — la réponse sans bloc ni marques. */
  text(): string;
};

/**
 * Ce qui termine une marque : son crochet, une fin de ligne — une marque tient
 * sur sa ligne — ou un `[` : une marque jamais refermée suivie d'une autre
 * (`[qa:lic-01 [qa:sit-02]`) ne fusionne pas avec elle, le `[` reste pour
 * ouvrir la suivante.
 */
const MARK_END = /[\]\r\n[]/;

/**
 * Un filtre neuf pour un flux. L'automate a quatre états : hors bloc (le texte
 * passe, sauf un `<` qui pourrait ouvrir — ou fermer : un `</sources>`
 * orphelin est retiré, il n'a rien à faire à l'écran — et un `[` qui pourrait
 * ouvrir une marque), dans le bloc (tout est capturé jusqu'à `</sources>`),
 * dans une marque (tout est capturé jusqu'au `]`), après le bloc (le texte
 * passe de nouveau — un second bloc serait capturé de même, ses identifiants
 * ajoutés au premier). Balises et ouvertures de marque sont reconnues quelle
 * que soit leur casse.
 */
export function createSourcesFilter(): SourcesFilter {
  let held = '';
  let inBlock = false;
  let inMark = false;
  let markPrefix = '';
  let markAt = 0;
  let captured: string | null = null;
  const marks: Mark[] = [];
  let released = '';

  const release = (text: string): string => {
    released += text;
    return text;
  };

  const captureMark = (body: string): void => {
    // Le modèle met parfois des accents graves ou des espaces autour d'une clé.
    const key = body.trim().replace(/^`+|`+$/g, '').trim();
    marks.push({id: markPrefix + key, at: markAt});
  };

  /**
   * La longueur du plus long suffixe de `text` qui soit un préfixe strict de
   * `<sources>`, de `</sources>`, de `[qa:` ou de `[cv:`, casse ignorée — ce
   * qu'il faut retenir en attendant de savoir.
   */
  const pendingPrefix = (text: string): number => {
    const tail = text.slice(-LONGEST_PENDING).toLowerCase();
    const longest = Math.min(tail.length, LONGEST_PENDING);
    for (let length = longest; length > 0; length -= 1) {
      const suffix = tail.slice(tail.length - length);
      if (SOURCES_OPEN.startsWith(suffix) || SOURCES_CLOSE.startsWith(suffix)) return length;
      if (MARK_PREFIXES.some((prefix) => prefix.length > length && prefix.startsWith(suffix))) return length;
    }
    return 0;
  };

  const drain = (): string => {
    let out = '';
    for (;;) {
      if (inBlock) {
        const close = CLOSE_TAG.exec(held);
        if (close === null) return out;
        captured = (captured ?? '') + held.slice(0, close.index);
        held = held.slice(close.index + close[0].length);
        inBlock = false;
        continue;
      }
      if (inMark) {
        const end = MARK_END.exec(held);
        if (end === null || end.index > MARK_MAX_CHARS) {
          if (end === null && held.length <= MARK_MAX_CHARS) return out;
          // Trop long pour être un identifiant : marque close à la borne,
          // malformée ; ce qui suit la borne est du texte — le même, que le
          // `]` soit dans ce morceau, plus loin, ou nulle part.
          captureMark(held.slice(0, MARK_MAX_CHARS));
          held = held.slice(MARK_MAX_CHARS);
          inMark = false;
          continue;
        }
        captureMark(held.slice(0, end.index));
        // Le `]` part avec la marque ; une fin de ligne ou un `[` reste du texte.
        held = held.slice(end[0] === ']' ? end.index + 1 : end.index);
        inMark = false;
        continue;
      }
      const open = OPEN_TAG.exec(held);
      const orphan = CLOSE_TAG.exec(held);
      const mark = MARK_OPEN.exec(held);
      const first = [open, orphan, mark]
        .filter((found): found is RegExpExecArray => found !== null)
        .sort((a, b) => a.index - b.index)[0];
      if (first !== undefined && first === mark) {
        out += release(held.slice(0, mark.index));
        held = held.slice(mark.index + mark[0].length);
        markPrefix = `${mark[1]!.toLowerCase()}:`;
        markAt = released.length;
        inMark = true;
        continue;
      }
      if (first !== undefined && first === open) {
        out += release(held.slice(0, open.index));
        held = held.slice(open.index + open[0].length);
        inBlock = true;
        // Un second bloc s'ajoute au premier, séparé par une virgule.
        if (captured !== null) captured += ',';
        continue;
      }
      if (first !== undefined && first === orphan) {
        // Une fermeture sans ouverture : retirée, le texte autour passe.
        out += release(held.slice(0, orphan.index));
        held = held.slice(orphan.index + orphan[0].length);
        continue;
      }
      const pending = pendingPrefix(held);
      out += release(held.slice(0, held.length - pending));
      held = held.slice(held.length - pending);
      return out;
    }
  };

  return {
    push(chunk) {
      held += chunk;
      return drain();
    },
    flush() {
      if (inBlock) {
        // Bloc ouvert, jamais refermé : c'est le bloc quand même, rien ne sort.
        captured = (captured ?? '') + held;
        held = '';
        inBlock = false;
        return '';
      }
      if (inMark) {
        // Marque ouverte, jamais refermée : capturée malformée, rien ne sort.
        captureMark(held);
        held = '';
        inMark = false;
        return '';
      }
      // Un `<sour` ou un `[q` en fin de flux n'était ni le bloc ni une marque : c'est du texte.
      const rest = held;
      held = '';
      return release(rest);
    },
    block() {
      return captured;
    },
    marks() {
      return marks;
    },
    text() {
      return released;
    }
  };
}

/**
 * Les identifiants déclarés dans un bloc, nettoyés et dédoublonnés, dans
 * l'ordre. Virgules, points-virgules, retours à la ligne et espaces séparent :
 * un modèle qui écrit `qa:a-1 qa:b-2` déclare deux clés, pas une clé fausse.
 * Les crochets du mode évaluation (`[qa:a-1]`) sont retirés comme les accents
 * graves : un bloc écrit avec la forme des marques déclare les mêmes clés.
 */
export function declaredSources(block: string | null): string[] {
  if (block === null) return [];
  const seen = new Set<string>();
  for (const raw of block.split(/[,\n;\s]+/)) {
    // Le modèle met parfois des accents graves, des crochets ou des espaces autour d'une clé.
    const key = raw.trim().replace(/^[`[]+|[`\]]+$/g, '').trim();
    if (key !== '') seen.add(key);
  }
  return [...seen];
}

export type CitationCheck = {
  /** Le texte de la réponse, sans le bloc ni les blancs qui le précédaient. */
  readonly text: string;
  /** Ce que le modèle a déclaré, tel quel après nettoyage. */
  readonly declared: readonly string[];
  /** Ce qui, parmi le déclaré, existe et se cite (AD-4). */
  readonly valid: readonly string[];
  /** Vrai si tout le déclaré est valide — donc aussi sans bloc du tout. */
  readonly ok: boolean;
};

/**
 * Le contrôle final d'une question : `isValid` est `knowledge.isValidSource`
 * lié à la langue courante — passé en paramètre pour que ce module reste sans
 * dépendance. Le bloc seul fait foi ici ; une marque qui se serait glissée
 * dans une réponse libre a été retirée du flux, et n'est pas comptée.
 */
export function checkCitations(filter: SourcesFilter, isValid: (id: string) => boolean): CitationCheck {
  const text = filter.text().trimEnd();
  const declared = declaredSources(filter.block());
  const valid = declared.filter((id) => SOURCE_KEY.test(id) && isValid(id));
  return {text, declared, valid, ok: valid.length === declared.length};
}

/** Les quatre titres d'une évaluation, dans l'ordre — ceux de `prompts.MATCH_TITLES`. */
export type MatchTitlesInput = {
  readonly strengths: string;
  readonly transferable: string;
  readonly gaps: string;
  readonly conclusion: string;
};

/**
 * L'ordre des quatre parties, celui de la structure imposée — le même que
 * `prompts.MATCH_PARTS`, écrit ici pour que ce module reste sans dépendance ;
 * un test affirme l'égalité des deux.
 */
export const MATCH_PART_ORDER = ['strengths', 'transferable', 'gaps', 'conclusion'] as const;

/**
 * Pourquoi une évaluation n'est pas en ordre — une liste close, journalisée
 * telle quelle (`agent.match_structure`), jamais le texte :
 *  - `missing_title` : un des quatre titres manque ;
 *  - `titles_out_of_order` : les quatre sont là, pas dans cet ordre ;
 *  - `unmarked_point` : un point des deux premières parties sans marque ;
 *  - `mark_under_gaps` : une marque sous les écarts ;
 *  - `invalid_mark` : une marque inconnue, PRIVÉ ou mal formée ;
 *  - `invalid_source` : une source du bloc inconnue, PRIVÉ ou mal formée.
 */
export type MatchStructureReason =
  | 'missing_title'
  | 'titles_out_of_order'
  | 'unmarked_point'
  | 'mark_under_gaps'
  | 'invalid_mark'
  | 'invalid_source';

export type MatchCitationCheck = CitationCheck & {
  /** Vide quand `ok` ; sinon chaque manquement, une fois. */
  readonly reasons: readonly MatchStructureReason[];
};

type Line = {readonly start: number; readonly content: string};

/** Les lignes du texte, avec l'offset de leur premier caractère. */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const content of text.split('\n')) {
    lines.push({start, content});
    start += content.length + 1;
  }
  return lines;
}

/**
 * Un mot replié pour la comparaison : forme décomposée, sans ses marques
 * diacritiques, en minuscules — « Ecarts », « Écarts » et sa forme NFD sont le
 * même titre. Le mot, lui, reste exact.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Le titre que porte une ligne, s'il en est un : en gras (`**Titre**`) seul
 * sur sa ligne, comme la règle le demande — un deux-points final, des
 * marqueurs manquants ou d'un autre type (`__Titre__`, `*Titre*`), la casse et
 * les accents sont tolérés ; le mot, lui, est exact. Exporté pour le runner de
 * la suite adverse (story 10), qui relit la structure avec la même lecture.
 */
export function titleOf(content: string, titles: MatchTitlesInput): keyof MatchTitlesInput | null {
  const trimmed = content.trim().replace(/\s*:$/, '');
  // `**Titre**`, `__Titre__`, `*Titre*` : les marqueurs collés au mot — « * Titre » est une puce, pas un titre.
  const emphasis = /^(\*\*|__|\*|_)(\S.*?\S|\S)\1$/.exec(trimmed);
  const bare = fold((emphasis ? emphasis[2]! : trimmed).trim().replace(/\s*:$/, ''));
  if (bare === '') return null;
  for (const part of MATCH_PART_ORDER) {
    if (bare === fold(titles[part])) return part;
  }
  return null;
}

/** `- item`, `* item`, `+ item`, `1. item` : un point de la liste — même lecture que le rendu (`markdown.tsx`). */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,2}[.)])\s+/;

type Range = {readonly start: number; readonly end: number};

/**
 * Les intervalles `[start, end)` des points d'une partie : un point commence
 * sur une ligne de liste et s'étend jusqu'à la prochaine ligne de liste, la
 * prochaine ligne vide ou la fin de la partie — sa continuation paresseuse
 * comprise, comme en CommonMark. Une ligne faite uniquement de marques (vide
 * une fois les marques retirées, mais où une marque se trouvait) appartient
 * au point qui la précède : « - Dix ans » puis « [qa:lic-01] » sur la ligne
 * suivante est un point marqué.
 */
function pointsOf(lines: readonly Line[], marks: readonly Mark[], from: number, to: number, end: number): Range[] {
  const carriesMark = (line: Line) =>
    marks.some((mark) => mark.at >= line.start && mark.at <= line.start + line.content.length);
  const isBoundary = (line: Line) => LIST_ITEM.test(line.content) || (line.content.trim() === '' && !carriesMark(line));
  const points: Range[] = [];
  for (let index = from; index < to; index += 1) {
    const line = lines[index]!;
    if (!LIST_ITEM.test(line.content)) continue;
    let stop = index + 1;
    while (stop < to && !isBoundary(lines[stop]!)) stop += 1;
    points.push({start: line.start, end: stop < lines.length ? lines[stop]!.start : end});
  }
  return points;
}

/**
 * Le contrôle final d'une évaluation (AD-17). Le texte relâché est relu ligne
 * à ligne : les quatre titres, dans l'ordre, découpent les parties ; chaque
 * marque, par sa position, tombe dans l'une d'elles.
 *
 * **Un point est un item de liste** (`-`, `*`, `+`, `1.`) — c'est ce que les
 * règles demandent au modèle, et c'est la seule chose contrôlée : sous les
 * deux premières parties, chaque item porte au moins une marque ; une phrase
 * sans puce (« Rien à signaler. », une partie vide dite d'une ligne) n'est pas
 * un point, elle n'est pas contrôlée. Sous les écarts, aucune marque, item ou
 * non. Sous la conclusion, rien n'est exigé.
 *
 * `ok` — le `citation_ok` journalisé — veut dire « tout en ordre » : la
 * structure, les marques par point, aucune sous les écarts, et chaque marque
 * comme chaque source du bloc valide. `reasons` dit sinon ce qui manque ; le
 * journal ne le garde pas, seule la ligne `agent.match_structure` le porte.
 * Le texte rendu est débarrassé des blancs que les marques retirées laissaient
 * en fin de ligne.
 */
export function checkMatchCitations(
  filter: SourcesFilter,
  isValid: (id: string) => boolean,
  titles: MatchTitlesInput
): MatchCitationCheck {
  const raw = filter.text();
  const marks = filter.marks();
  const reasons = new Set<MatchStructureReason>();
  const valid = (id: string) => SOURCE_KEY.test(id) && isValid(id);

  // La structure : les quatre titres, dans l'ordre.
  const lines = splitLines(raw);
  const at: Partial<Record<(typeof MATCH_PART_ORDER)[number], number>> = {};
  lines.forEach((line, index) => {
    const part = titleOf(line.content, titles);
    if (part !== null && at[part] === undefined) at[part] = index;
  });
  const found = MATCH_PART_ORDER.map((part) => at[part]);
  if (found.some((index) => index === undefined)) {
    reasons.add('missing_title');
  } else {
    const indexes = found as number[];
    if (indexes.some((index, rank) => rank > 0 && index <= indexes[rank - 1]!)) {
      reasons.add('titles_out_of_order');
    } else {
      // Les parties, en lignes et en offsets : chaque partie va de son titre au suivant.
      const end = raw.length + 1;
      const bounds = indexes.map((index, rank) => ({
        fromLine: index,
        toLine: rank + 1 < indexes.length ? indexes[rank + 1]! : lines.length,
        start: lines[index]!.start,
        end: rank + 1 < indexes.length ? lines[indexes[rank + 1]!]!.start : end
      }));
      const within = (range: Range) => marks.filter((mark) => mark.at >= range.start && mark.at < range.end);
      for (const rank of [0, 1]) {
        const part = bounds[rank]!;
        for (const point of pointsOf(lines, marks, part.fromLine + 1, part.toLine, part.end)) {
          if (within(point).length === 0) reasons.add('unmarked_point');
        }
      }
      if (within(bounds[2]!).length > 0) reasons.add('mark_under_gaps');
    }
  }

  // Les marques et le bloc : chacun valide, et leur union en sources.
  const markIds = [...new Set(marks.map((mark) => mark.id))];
  if (markIds.some((id) => !valid(id))) reasons.add('invalid_mark');
  const blockIds = declaredSources(filter.block());
  if (blockIds.some((id) => !valid(id))) reasons.add('invalid_source');
  const declared = [...new Set([...markIds, ...blockIds])];

  return {
    // Une marque retirée laissait un blanc en fin de ligne : il part avec elle.
    text: raw.replace(/[ \t]+$/gm, '').trimEnd(),
    declared,
    valid: declared.filter(valid),
    ok: reasons.size === 0,
    reasons: [...reasons]
  };
}
