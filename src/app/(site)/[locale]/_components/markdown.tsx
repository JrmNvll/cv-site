/**
 * Le sous-ensemble Markdown du corpus, rendu en éléments React — jamais en HTML.
 *
 * Le corps d'une entrée voyage tel quel, en Markdown (AD-3) ; c'est ici qu'il
 * devient lisible. Le sous-ensemble est celui que le corpus emploie —
 * paragraphes, listes à puces (`-`, `*` ou `+`) et numérotées (`1.`),
 * `**gras**`, `*italique*` ou `_italique_`. Tout le reste — titres, citations,
 * liens, images, code, balises HTML — s'affiche **en texte**, tel qu'écrit.
 *
 * Deux extensions, **désactivées par défaut** et réservées aux deux pages de
 * prose du site (story 9), qui seules les demandent (`ProseArticle`) : les
 * titres `##` et `###` (`headings`), et les liens `[texte](adresse)` vers une
 * adresse **sûre** — `http(s)://` absolue, ou un chemin `/…` du site, sans
 * barre oblique inverse ni caractère de contrôle (`links`). Un lien `mailto:`,
 * `javascript:`, `data:`, une image, un titre `#` seul ou `####` restent du
 * texte même là. Le panneau de l'assistant et l'admin rendent tout en texte :
 * un lien ou un titre émis par le modèle — une annonce collée peut en
 * contenir — n'y devient ni cliquable ni un titre de la page.
 *
 * Deux raisons de ne pas prendre une bibliothèque :
 *  - la surface : un rendu complet reconnaît le HTML brut, les images et tout
 *    schéma d'adresse ; ici rien de tout cela n'est voulu, et ce qui n'est pas
 *    reconnu ne peut pas être interprété. React échappe chaque chaîne rendue,
 *    il n'y a aucun `dangerouslySetInnerHTML` à contrôler ;
 *  - la taille : le sous-ensemble tient en moins de deux cents lignes utiles.
 *
 * Ce module ne dépend de rien : il est appelé par le composant client du
 * panneau, par les pages de prose et par l'admin, et testable sans navigateur
 * (`tests/unit/markdown.test.ts`).
 */
import type {ReactNode} from 'react';

/** `- item`, `* item`, `+ item` — jusqu'à trois espaces devant, comme CommonMark ; même lecture que `agent/citations.ts`. */
const UNORDERED_ITEM = /^ {0,3}[-*+]\s+(.*)$/;
/** `1. item`, `1) item`. */
// Un ou deux chiffres : « 2024. Départ… » au fil d'un paragraphe reste du texte,
// une liste numérotée ne commence pas à 2024.
const ORDERED_ITEM = /^ {0,3}(\d{1,2})[.)]\s+(.*)$/;
/**
 * `## Titre`, `### Titre` — deux ou trois dièses, une espace, du texte ; des
 * dièses de fermeture sont tolérés, comme en CommonMark. Un dièse seul est le
 * titre de la page, qui vient d'ailleurs ; quatre et plus n'ont pas de place
 * dans une page ni dans une réponse : du texte.
 */
const HEADING = /^ {0,3}(#{2,3})\s+(.*?)(?:\s+#+)?\s*$/;

type Block =
  | {kind: 'paragraph'; lines: string[]}
  | {kind: 'heading'; level: 2 | 3; text: string}
  | {kind: 'list'; ordered: boolean; start: number; items: string[]};

/** Ce que le rendu reconnaît en plus du sous-ensemble du corpus — rien, par défaut. */
export type MarkdownOptions = {
  /** `##` et `###` en `h2` et `h3` ; sinon, du texte. */
  readonly headings?: boolean;
  /** `[texte](adresse)` en lien, si l'adresse est sûre ; sinon, du texte. */
  readonly links?: boolean;
};

/**
 * Découpe le texte en blocs. Une ligne vide ferme le bloc courant ; un titre
 * (si les titres sont reconnus) est un bloc à lui seul et ferme ce qui le
 * précède — sauf s'il n'est fait que de dièses, `## ##` : un paragraphe ; une
 * ligne de liste ouvre ou prolonge une liste (elle peut interrompre un
 * paragraphe, comme en CommonMark) ; toute autre ligne prolonge le bloc
 * ouvert — la suite d'un item de liste ou d'un paragraphe — ou en ouvre un.
 */
function parseBlocks(text: string, headings: boolean): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      current = null;
      continue;
    }

    const heading = headings ? HEADING.exec(line) : null;
    if (heading !== null && heading[2] !== '' && !/^#+$/.test(heading[2]!)) {
      blocks.push({kind: 'heading', level: heading[1]!.length === 2 ? 2 : 3, text: heading[2]!});
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
 * Une adresse qu'un lien peut porter : `http://` ou `https://` absolue, ou un
 * chemin du site — qui commence par `/` et pas par `//` (une adresse relative
 * au protocole mènerait ailleurs). Sans espace ni parenthèse : un lien
 * Markdown se ferme sur la première. Sans barre oblique inverse ni caractère
 * de contrôle : le navigateur normalise `/\evil.com` en `//evil.com`, et un
 * caractère de contrôle se laisse ignorer par l'analyseur d'URL. Tout autre
 * schéma — `mailto:`, `javascript:`, `data:`, un chemin relatif — n'est pas
 * une adresse ici.
 */
export function isSafeHref(href: string): boolean {
  if (href === '' || /[\s()\\]/.test(href) || hasControlChar(href)) return false;
  return /^https?:\/\/\S+$/i.test(href) || (href.startsWith('/') && !href.startsWith('//'));
}

/** Un caractère de contrôle C0 ou DEL, quelque part dans l'adresse. */
function hasControlChar(href: string): boolean {
  for (let index = 0; index < href.length; index += 1) {
    const code = href.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Ce que porte chaque lien rendu ; jamais de `target`. */
export const LINK_REL = 'nofollow noopener noreferrer';

type FoundLink = {readonly label: string; readonly href: string; readonly end: number};

/**
 * Un lien `[texte](adresse)` ouvert à `index`, ou `null` : le texte ne contient
 * ni crochet ni fin de ligne, l'adresse suit sans espace et doit être sûre.
 * Un `[` précédé de `!` est une image : rien à rendre, elle reste du texte.
 */
function findLink(text: string, index: number): FoundLink | null {
  if (text[index] !== '[' || text[index - 1] === '!') return null;
  const close = text.indexOf(']', index + 1);
  if (close === -1 || text[close + 1] !== '(') return null;
  const label = text.slice(index + 1, close);
  if (label.trim() === '' || /[[\]\n]/.test(label)) return null;
  const end = text.indexOf(')', close + 2);
  if (end === -1) return null;
  const href = text.slice(close + 2, end);
  return isSafeHref(href) ? {label, href, end: end + 1} : null;
}

/**
 * La position du marqueur fermant d'une emphase, ou `-1` — comme `findClose`,
 * mais sans jamais fermer **à l'intérieur** d'un lien ouvert entre les deux :
 * dans `_a [b](/x_) c_`, le `_` de l'adresse n'est pas une fermeture, le lien
 * reste entier dans l'italique. Sans lien reconnu, rien ne change.
 */
function findEmphasisClose(text: string, from: number, marker: string, links: boolean): number {
  let close = findClose(text, from, marker);
  while (links && close !== -1) {
    const link = linkSpanning(text, from, close);
    if (link === null) break;
    close = findClose(text, link.end, marker);
  }
  return close;
}

/** Le premier lien ouvert dans `[from, at)` qui s'étend au-delà de `at`, ou `null`. */
function linkSpanning(text: string, from: number, at: number): FoundLink | null {
  for (let index = text.indexOf('[', from); index !== -1 && index < at; index = text.indexOf('[', index + 1)) {
    const found = findLink(text, index);
    if (found !== null) {
      if (found.end > at) return found;
      index = found.end - 1;
    }
  }
  return null;
}

/**
 * Le texte d'une ligne, gras et italiques reconnus — et les liens, si demandé
 * —, le reste en chaînes. Un marqueur sans fermeture, ou suivi d'une espace,
 * est du texte comme un autre ; un lien vers une adresse refusée aussi.
 */
function inline(text: string, keyPrefix: string, allowLinks: boolean): ReactNode[] {
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
    const close = findEmphasisClose(text, index + marker.length, marker, allowLinks);
    if (close <= index + marker.length) return false;
    const content = text.slice(index + marker.length, close);
    // Une emphase sans texte (`****`, `* *`) n'en est pas une.
    if (/^[*_\s]*$/.test(content)) return false;
    flush();
    const childKey = `${keyPrefix}-${key++}`;
    nodes.push(<Tag key={childKey}>{inline(content, childKey, allowLinks)}</Tag>);
    index = close + marker.length;
    return true;
  };
  const link = (): boolean => {
    if (!allowLinks) return false;
    const found = findLink(text, index);
    if (found === null) return false;
    flush();
    const childKey = `${keyPrefix}-${key++}`;
    // Le texte du lien connaît le gras et l'italique, jamais un second lien.
    nodes.push(
      <a key={childKey} href={found.href} rel={LINK_REL}>
        {inline(found.label, childKey, false)}
      </a>
    );
    index = found.end;
    return true;
  };

  while (index < text.length) {
    if (emphasis('**', 'strong') || emphasis('*', 'em') || emphasis('_', 'em') || link()) continue;
    literal += text[index];
    index += 1;
  }
  flush();
  return nodes;
}

/**
 * Le corps d'une entrée — ou d'une page —, en éléments React. Un texte vide
 * rend une liste vide. Sans option, le sous-ensemble du corpus et rien de
 * plus ; `headings` et `links` sont l'affaire des pages de prose.
 */
export function renderMarkdown(text: string, options: MarkdownOptions = {}): ReactNode {
  const headings = options.headings === true;
  const links = options.links === true;
  return parseBlocks(text, headings).map((block, position) => {
    if (block.kind === 'paragraph') {
      return <p key={position}>{inline(block.lines.join('\n'), `p${position}`, links)}</p>;
    }
    if (block.kind === 'heading') {
      const Tag = block.level === 2 ? 'h2' : 'h3';
      return <Tag key={position}>{inline(block.text, `h${position}`, links)}</Tag>;
    }
    const items = block.items.map((item, rank) => (
      <li key={rank}>{inline(item, `l${position}-${rank}`, links)}</li>
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
