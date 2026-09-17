/**
 * Le sous-ensemble Markdown du corpus, rendu en éléments React (AD-3, story 5).
 *
 * Trois choses à prouver : chaque construction du sous-ensemble se rend en
 * l'élément attendu ; ce qui n'en fait pas partie s'affiche **en texte**, tel
 * qu'écrit ; et rien de ce qu'un corps contient ne peut devenir du HTML — il
 * n'y a pas de HTML brut dans le corpus, mais le rendu ne doit pas en dépendre.
 *
 * Le rendu est comparé sous sa forme HTML statique : c'est ce que le navigateur
 * reçoit, échappement compris.
 */
import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {renderMarkdown} from '@/app/[locale]/_components/markdown';

function html(text: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(text)));
}

describe('paragraphes', () => {
  it('sépare les paragraphes sur une ligne vide', () => {
    expect(html('Premier.\n\nSecond.')).toBe('<p>Premier.</p><p>Second.</p>');
  });

  it('garde dans un même paragraphe deux lignes qui se suivent', () => {
    expect(html('Une ligne\nla suivante.')).toBe('<p>Une ligne\nla suivante.</p>');
  });

  it('ignore les lignes vides en tête, en queue et en double', () => {
    expect(html('\n\nSeul.\n\n\n')).toBe('<p>Seul.</p>');
  });

  it('rend une chaîne vide sans rien', () => {
    expect(html('')).toBe('');
    expect(html('   \n  ')).toBe('');
  });

  it('accepte les fins de ligne Windows', () => {
    expect(html('Un.\r\n\r\nDeux.')).toBe('<p>Un.</p><p>Deux.</p>');
  });
});

describe('listes', () => {
  it('rend une liste à puces avec `-`', () => {
    expect(html('- un\n- deux')).toBe('<ul><li>un</li><li>deux</li></ul>');
  });

  it('rend une liste à puces avec `*`', () => {
    expect(html('* un\n* deux')).toBe('<ul><li>un</li><li>deux</li></ul>');
  });

  it('rend une liste à puces avec `+` — la même lecture que le contrôle des évaluations', () => {
    expect(html('+ un\n+ deux')).toBe('<ul><li>un</li><li>deux</li></ul>');
    // Un `+` sans espace reste du texte.
    expect(html('+1 an')).toBe('<p>+1 an</p>');
  });

  it('rend une liste numérotée, et garde le premier numéro sʼil nʼest pas 1', () => {
    expect(html('1. un\n2. deux')).toBe('<ol><li>un</li><li>deux</li></ol>');
    expect(html('3. trois\n4. quatre')).toBe('<ol start="3"><li>trois</li><li>quatre</li></ol>');
  });

  it('laisse une liste interrompre un paragraphe, et un paragraphe suivre une liste', () => {
    expect(html('Intro :\n- a\n- b\n\nSuite.')).toBe(
      '<p>Intro :</p><ul><li>a</li><li>b</li></ul><p>Suite.</p>'
    );
  });

  it('rattache à lʼitem la ligne qui le continue', () => {
    expect(html('- un item\nqui continue\n- suivant')).toBe(
      '<ul><li>un item\nqui continue</li><li>suivant</li></ul>'
    );
  });

  it('sépare deux listes de nature différente', () => {
    expect(html('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('ne prend pas pour une puce un tiret sans espace, ni une italique en tête de ligne', () => {
    expect(html('-1 degré')).toBe('<p>-1 degré</p>');
    expect(html('*italique* en tête')).toBe('<p><em>italique</em> en tête</p>');
  });
});

describe('gras et italique', () => {
  it('rend `**gras**`', () => {
    expect(html('du **gras** ici')).toBe('<p>du <strong>gras</strong> ici</p>');
  });

  it('rend `*italique*` et `_italique_`', () => {
    expect(html('de l’*italique* et de l’_italique_')).toBe(
      '<p>de l’<em>italique</em> et de l’<em>italique</em></p>'
    );
  });

  it('imbrique lʼitalique dans le gras, et le gras dans lʼitalique', () => {
    expect(html('**gras *et* italique**')).toBe('<p><strong>gras <em>et</em> italique</strong></p>');
    expect(html('*a **b** c*')).toBe('<p><em>a <strong>b</strong> c</em></p>');
  });

  it('rend le gras et lʼitalique dans un item de liste', () => {
    expect(html('- **clé** : _valeur_')).toBe('<ul><li><strong>clé</strong> : <em>valeur</em></li></ul>');
  });

  it('laisse en texte un marqueur sans fermeture', () => {
    expect(html('**ouvert sans fin')).toBe('<p>**ouvert sans fin</p>');
    expect(html('un * seul')).toBe('<p>un * seul</p>');
    expect(html('****')).toBe('<p>****</p>');
  });

  it('ne fait pas dʼune multiplication une emphase', () => {
    expect(html('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  });

  it('laisse un mot en snake_case entier', () => {
    expect(html('la variable ma_valeur_ici est lue')).toBe('<p>la variable ma_valeur_ici est lue</p>');
  });
});

describe('tout le reste est du texte', () => {
  it.each([
    ['un titre', '# Titre', '<p># Titre</p>'],
    ['une citation', '> citée', '<p>&gt; citée</p>'],
    ['du code', 'appeler `f()`', '<p>appeler `f()`</p>'],
    ['un lien', '[site](https://exemple.invalid)', '<p>[site](https://exemple.invalid)</p>'],
    ['une image', '![photo](x.jpg)', '<p>![photo](x.jpg)</p>'],
    ['un filet', 'avant\n\n---\n\naprès', '<p>avant</p><p>---</p><p>après</p>']
  ])('affiche %s tel quʼécrit', (_label, source, attendu) => {
    expect(html(source)).toBe(attendu);
  });
});

describe('aucune injection', () => {
  it('échappe le HTML dʼun corps au lieu de lʼinterpréter', () => {
    const rendu = html('<script>alert(1)</script> et <b>gras</b>');
    expect(rendu).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; et &lt;b&gt;gras&lt;/b&gt;</p>');
    expect(rendu).not.toContain('<script');
    expect(rendu).not.toContain('<b>');
  });

  it('échappe aussi à lʼintérieur du gras, de lʼitalique et des listes', () => {
    expect(html('**<img src=x onerror=alert(1)>**')).toBe(
      '<p><strong>&lt;img src=x onerror=alert(1)&gt;</strong></p>'
    );
    expect(html('- <a href="javascript:x">lien</a>')).toBe(
      '<ul><li>&lt;a href=&quot;javascript:x&quot;&gt;lien&lt;/a&gt;</li></ul>'
    );
  });

  it('nʼa aucun rendu par `dangerouslySetInnerHTML`', async () => {
    const {readFileSync} = await import('node:fs');
    const {fileURLToPath} = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../../src/app/[locale]/_components/markdown.tsx', import.meta.url)),
      'utf8'
    );
    // L'attribut posé, pas le mot dans un commentaire.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
  });
});
