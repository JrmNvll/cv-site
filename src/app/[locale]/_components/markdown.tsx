/**
 * Le sous-ensemble Markdown du corpus, rendu en éléments React — jamais en HTML.
 *
 * Le corps d'une entrée voyage tel quel, en Markdown (AD-3) ; c'est ici qu'il
 * devient lisible. Le sous-ensemble est celui que le corpus emploie, et rien de
 * plus : paragraphes, listes à puces (`-` ou `*`) et numérotées (`1.`),
 * `**gras**`, `*italique*` ou `_italique_`. Tout le reste — titres, citations,
 * liens, images, code, balises HTML — s'affiche **en texte**, tel qu'écrit.
 *
 * Deux raisons de ne pas prendre une bibliothèque :
 *  - la surface : un rendu complet reconnaît le HTML brut, les liens et les
 *    images ; ici rien de tout cela n'est voulu, et ce qui n'est pas reconnu
 *    ne peut pas être interprété. React échappe chaque chaîne rendue, il n'y a
 *    aucun `dangerouslySetInnerHTML` à contrôler ;
 *  - la taille : le sous-ensemble tient en moins de cent lignes utiles.
 *
 * Ce module ne dépend de rien : il est appelé par le composant client du
 * panneau, et testable sans navigateur (`tests/unit/markdown.test.ts`).
 */
import type {ReactNode} from 'react';

/** `- item`, `* item` — jusqu'à trois espaces devant, comme CommonMark. */
const UNORDERED_ITEM = /^ {0,3}[-*]\s+(.*)$/;
/** `1. item`, `1) item`. */
// Un ou deux chiffres : « 2024. Départ… » au fil d'un paragraphe reste du texte,
// une liste numérotée ne commence pas à 2024.
const ORDERED_ITEM = /^ {0,3}(\d{1,2})[.)]\s+(.*)$/;

type Block =
  | {kind: 'paragraph'; lines: string[]}
  | {kind: 'list'; ordered: boolean; start: number; items: string[]};

/**
 * Découpe le texte en blocs. Une ligne vide ferme le bloc courant ; une ligne
 * de liste ouvre ou prolonge une liste (elle peut interrompre un paragraphe,
 * comme en CommonMark) ; toute autre ligne prolonge le bloc ouvert — la suite
 * d'un item de liste ou d'un paragraphe — ou en ouvre un.
 */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      current = null;
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered === null ? ORDERED_ITEM.exec(line) : null;
    if (unordered !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const item = (isOrdered ? ordered[2] : unordered![1])!;
      if (current?.kind === 'list' && current.ordered === isOrdered) {
        current.items.push(item);
      } else {
        current = {kind: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: [item]};
        blocks.push(current);
      }
      continue;
    }

    if (current?.kind === 'list') {
      // Continuation « paresseuse » d'un item, sur la ligne suivante.
      current.items[current.items.length - 1] += `\n${line.trim()}`;
    } else if (current?.kind === 'paragraph') {
      current.lines.push(line);
    } else {
      current = {kind: 'paragraph', lines: [line]};
      blocks.push(current);
    }
  }
  return blocks;
}

/** Lettres et chiffres latins, accents compris : ce qui fait un « mot ». */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-zÀ-ɏ]/.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * La position du marqueur fermant, ou `-1`. Un marqueur fermant n'est pas
 * précédé d'une espace (`* 3 *` n'est pas une emphase) et, pour `_`, n'est pas
 * suivi d'une lettre (`snake_case_name` reste un mot). Un `*` seul ne se ferme
 * pas sur un `**` : le gras imbriqué dans l'italique reste entier.
 */
function findClose(text: string, from: number, marker: string): number {
  let at = text.indexOf(marker, from);
  while (at !== -1) {
    if (marker === '*' && text.startsWith('**', at)) {
      at = text.indexOf(marker, at + 2);
      continue;
    }
    const closes =
      !isSpace(text[at - 1]) && (marker !== '_' || !isWordChar(text[at + marker.length]));
    if (closes) return at;
    at = text.indexOf(marker, at + 1);
  }
  return -1;
}

/**
 * Le texte d'une ligne, gras et italiques reconnus, le reste en chaînes. Un
 * marqueur sans fermeture, ou suivi d'une espace, est du texte comme un autre.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let literal = '';
  let index = 0;
  let key = 0;

  const flush = (): void => {
    if (literal !== '') nodes.push(literal);
    literal = '';
  };
  const emphasis = (marker: string, Tag: 'strong' | 'em'): boolean => {
    const opens = text.startsWith(marker, index) && !isSpace(text[index + marker.length]);
    if (!opens || (marker === '_' && isWordChar(text[index - 1]))) return false;
    const close = findClose(text, index + marker.length, marker);
    if (close <= index + marker.length) return false;
    const content = text.slice(index + marker.length, close);
    // Une emphase sans texte (`****`, `* *`) n'en est pas une.
    if (/^[*_\s]*$/.test(content)) return false;
    flush();
    const childKey = `${keyPrefix}-${key++}`;
    nodes.push(<Tag key={childKey}>{inline(content, childKey)}</Tag>);
    index = close + marker.length;
    return true;
  };

  while (index < text.length) {
    if (emphasis('**', 'strong') || emphasis('*', 'em') || emphasis('_', 'em')) continue;
    literal += text[index];
    index += 1;
  }
  flush();
  return nodes;
}

/** Le corps d'une entrée, en éléments React. Un texte vide rend une liste vide. */
export function renderMarkdown(text: string): ReactNode {
  return parseBlocks(text).map((block, position) => {
    if (block.kind === 'paragraph') {
      return <p key={position}>{inline(block.lines.join('\n'), `p${position}`)}</p>;
    }
    const items = block.items.map((item, rank) => (
      <li key={rank}>{inline(item, `l${position}-${rank}`)}</li>
    ));
    return block.ordered ? (
      <ol key={position} start={block.start === 1 ? undefined : block.start}>
        {items}
      </ol>
    ) : (
      <ul key={position}>{items}</ul>
    );
  });
}
