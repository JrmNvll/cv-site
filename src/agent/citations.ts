/**
 * Le bloc `<sources>` — AD-4 et AD-16 : retiré **côté serveur**, jamais vu du
 * navigateur, contrôlé a posteriori, résultat journalisé.
 *
 * Deux parties :
 *
 *  1. **Le filtre de flux.** Le modèle écrit par morceaux, et le bloc peut
 *     arriver fragmenté — `<sour` puis `ces>…`, ou un caractère à la fois. Le
 *     filtre retient le texte depuis un `<` non résolu tant qu'il peut encore
 *     être le début de `<sources>`, et relâche tout ce qui ne l'est pas : un
 *     `<` suivi d'autre chose, une balise inconnue, une comparaison « a < b ».
 *     Rien du bloc ne sort ; rien d'autre n'est retenu plus longtemps que
 *     nécessaire.
 *  2. **L'extraction et le contrôle.** Une fois le flux fini, les identifiants
 *     déclarés sont lus, mis en forme, dédoublonnés, puis chacun est vérifié
 *     contre la connaissance de la langue courante. Une source invalide est
 *     retirée et `ok` vaut faux ; sans bloc du tout — un refus — `ok` vaut vrai.
 *
 * Aucune dépendance : lisible et testable seul, caractère par caractère.
 */

export const SOURCES_OPEN = '<sources>';
export const SOURCES_CLOSE = '</sources>';
/** Les balises se reconnaissent **sans tenir compte de la casse** : `<Sources>`, `<SOURCES>` sont le bloc. */
const OPEN_TAG = /<sources>/i;
const CLOSE_TAG = /<\/sources>/i;
/** Le plus long préfixe strict d'une balise qu'un texte peut retenir en attente. */
const LONGEST_PENDING = SOURCES_CLOSE.length - 1;

/** Une clé de citation bien formée : `qa:<id>` ou `cv:<chemin>` (AD-4). */
const SOURCE_KEY = /^(?:qa|cv):[a-z0-9][a-z0-9_.-]*$/;

export type SourcesFilter = {
  /** Reçoit un morceau du flux ; rend ce qui peut être transmis maintenant. */
  push(chunk: string): string;
  /** Le flux est fini : rend ce qui était retenu et n'est pas le bloc. */
  flush(): string;
  /** Le contenu du bloc `<sources>` capturé, ou `null` s'il n'y en a pas eu. */
  block(): string | null;
  /** Tout le texte relâché jusqu'ici, bout à bout — la réponse sans son bloc. */
  text(): string;
};

/**
 * Un filtre neuf pour un flux. L'automate a trois états : hors bloc (le texte
 * passe, sauf un `<` qui pourrait ouvrir — ou fermer : un `</sources>`
 * orphelin est retiré, il n'a rien à faire à l'écran), dans le bloc (tout est
 * capturé jusqu'à `</sources>`), après le bloc (le texte passe de nouveau — un
 * second bloc serait capturé de même, ses identifiants ajoutés au premier).
 * Les balises sont reconnues quelle que soit leur casse.
 */
export function createSourcesFilter(): SourcesFilter {
  let held = '';
  let inBlock = false;
  let captured: string | null = null;
  let released = '';

  const release = (text: string): string => {
    released += text;
    return text;
  };

  /**
   * La longueur du plus long suffixe de `text` qui soit un préfixe strict de
   * `<sources>` ou de `</sources>`, casse ignorée — ce qu'il faut retenir en
   * attendant de savoir.
   */
  const pendingPrefix = (text: string): number => {
    const tail = text.slice(-LONGEST_PENDING).toLowerCase();
    const longest = Math.min(tail.length, LONGEST_PENDING);
    for (let length = longest; length > 0; length -= 1) {
      const suffix = tail.slice(tail.length - length);
      if (SOURCES_OPEN.startsWith(suffix) || SOURCES_CLOSE.startsWith(suffix)) return length;
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
      const open = OPEN_TAG.exec(held);
      const orphan = CLOSE_TAG.exec(held);
      if (open !== null && (orphan === null || open.index < orphan.index)) {
        out += release(held.slice(0, open.index));
        held = held.slice(open.index + open[0].length);
        inBlock = true;
        // Un second bloc s'ajoute au premier, séparé par une virgule.
        if (captured !== null) captured += ',';
        continue;
      }
      if (orphan !== null) {
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
      // Un `<sour` en fin de flux n'était pas le bloc : c'est du texte.
      const rest = held;
      held = '';
      return release(rest);
    },
    block() {
      return captured;
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
 */
export function declaredSources(block: string | null): string[] {
  if (block === null) return [];
  const seen = new Set<string>();
  for (const raw of block.split(/[,\n;\s]+/)) {
    // Le modèle met parfois des accents graves ou des espaces autour d'une clé.
    const key = raw.trim().replace(/^`+|`+$/g, '').trim();
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
 * Le contrôle final : `isValid` est `knowledge.isValidSource` lié à la langue
 * courante — passé en paramètre pour que ce module reste sans dépendance.
 */
export function checkCitations(filter: SourcesFilter, isValid: (id: string) => boolean): CitationCheck {
  const text = filter.text().trimEnd();
  const declared = declaredSources(filter.block());
  const valid = declared.filter((id) => SOURCE_KEY.test(id) && isValid(id));
  return {text, declared, valid, ok: valid.length === declared.length};
}
