/**
 * Le texte d'une entrée, débarrassé de son balisage Markdown — pour l'index
 * de récupération seulement (AD-3 : « construit sur le texte débalisé »).
 *
 * Le corps d'une entrée part au modèle **tel quel** ; ceci ne touche jamais ce
 * qui est stocké ni ce qui est transmis. Il ne sert qu'à ce que l'index compte
 * des mots et non des marqueurs : `**gras**` doit indexer « gras », pas
 * « **gras** » ; `[texte](url)` doit indexer « texte », pas l'adresse ; un bloc
 * de code garde son contenu, pas ses clôtures.
 *
 * Aucune bibliothèque : le corpus emploie un Markdown simple, et un analyseur
 * complet reconnaîtrait bien plus que ce qui est voulu ici. Ce qui n'est pas
 * reconnu reste du texte — c'est la bonne erreur pour un index.
 */

/** Clôture de bloc de code : trois marqueurs ou plus, jusqu'à trois espaces devant. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,}).*$/;
/** `# Titre` … `###### Titre`. */
const HEADING = /^ {0,3}#{1,6}\s+/;
/** `- item`, `* item`, `+ item`, `1. item`, `1) item`. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
/** `> citation`. */
const QUOTE = /^ {0,3}>\s?/;
/** `---`, `***`, `___`. */
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * Un caractère échappé (`\*`) est un caractère, pas un marqueur : il est mis
 * à l'abri dans la zone à usage privé d'Unicode le temps du débalisage, puis
 * restitué tel quel.
 */
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!>~|<])/g;
const SHELTER_BASE = 0xe100;
const SHELTERED = /[\ue100-\ue17f]/g;

function shelter(line: string): string {
  return line.replace(ESCAPED, (_, char: string) => String.fromCharCode(SHELTER_BASE + char.charCodeAt(0)));
}

function restore(line: string): string {
  return line.replace(SHELTERED, (char) => String.fromCharCode(char.charCodeAt(0) - SHELTER_BASE));
}

/** Ce qui, dans une ligne, n'est que du balisage. */
function stripInline(raw: string): string {
  const line = shelter(raw);
  return restore(
    line
      // Images : l'alternative textuelle compte, pas l'adresse.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Liens : le texte compte, pas l'adresse.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Liens automatiques `<https://…>` : l'adresse est un mot comme un autre.
      .replace(/<(https?:\/\/[^>]+)>/g, '$1')
      // Code en ligne : le contenu, sans les accents graves.
      .replace(/`([^`]*)`/g, '$1')
      // Balises HTML : rien du corpus n'en emploie ; si une passe, elle n'indexe rien.
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      // Gras et italique, dans cet ordre : `***x***`, `**x**`, `__x__`, `*x*`, `_x_`.
      // Le tiret bas n'est une emphase qu'aux frontières de mot : `cv_visitor`
      // ou `snake_case_name` sont des mots, pas des italiques.
      .replace(/\*\*\*(\S(?:.*?\S)?)\*\*\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}])___(\S(?:.*?\S)?)___(?![\p{L}\p{N}])/gu, '$1')
      .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}])__(\S(?:.*?\S)?)__(?![\p{L}\p{N}])/gu, '$1')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}])_(\S(?:.*?\S)?)_(?![\p{L}\p{N}])/gu, '$1')
      // Barré.
      .replace(/~~(\S(?:.*?\S)?)~~/g, '$1')
  );
}

/**
 * Le texte débalisé, une ligne par ligne, sans marqueurs de structure ni
 * d'emphase. Les espaces sont normalisés : l'index n'en a que faire, et une
 * ligne vide reste une frontière de mots.
 */
export function stripMarkdown(text: string): string {
  const lines: string[] = [];
  let inFence = false;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(raw.trim());
      continue;
    }
    if (THEMATIC_BREAK.test(raw)) continue;

    let line = raw;
    // Une citation peut contenir un titre ou une liste : les marqueurs se
    // retirent de l'extérieur vers l'intérieur.
    line = line.replace(QUOTE, '');
    line = line.replace(HEADING, '');
    line = line.replace(LIST_MARKER, '');
    line = stripInline(line);
    lines.push(line.replace(/[ \t\u00a0\u202f]+/g, ' ').trim());
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
