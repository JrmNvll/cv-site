/**
 * Le sous-ensemble Markdown du corpus, rendu en éléments React (AD-3, story 5).
 *
 * Trois choses à prouver : chaque construction du sous-ensemble se rend en
 * l'élément attendu ; ce qui n'en fait pas partie s'affiche **en texte**, tel
 * qu'écrit ; et rien de ce qu'un corps contient ne peut devenir du HTML — il
 * n'y a pas de HTML brut dans le corpus, mais le rendu ne doit pas en dépendre.
 *
 * Depuis la story 9, deux extensions **sur demande** — titres et liens sûrs —
 * pour les pages de prose : `prose()` les active, `html()` est le rendu par
 * défaut, celui du panneau et de l'admin, où tout cela reste du texte.
 *
 * Le rendu est comparé sous sa forme HTML statique : c'est ce que le navigateur
 * reçoit, échappement compris.
 */
import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {isSafeHref, renderMarkdown, type MarkdownOptions} from '@/app/(site)/[locale]/_components/markdown';

function html(text: string, options?: MarkdownOptions): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(text, options)));
}

/** Le rendu des pages de prose : titres et liens reconnus. */
function prose(text: string): string {
  return html(text, {headings: true, links: true});
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

describe('titres (story 9)', () => {
  it('rend `##` en h2 et `###` en h3, chacun un bloc à lui seul', () => {
    expect(prose('## Une section')).toBe('<h2>Une section</h2>');
    expect(prose('### Un sous-titre')).toBe('<h3>Un sous-titre</h3>');
    expect(prose('Intro.\n## Section\nSuite.')).toBe('<p>Intro.</p><h2>Section</h2><p>Suite.</p>');
  });

  it('ferme une liste, et tolère les dièses de fermeture', () => {
    expect(prose('- a\n## Titre\n- b')).toBe('<ul><li>a</li></ul><h2>Titre</h2><ul><li>b</li></ul>');
    expect(prose('## Titre ##')).toBe('<h2>Titre</h2>');
    expect(prose('  ## Titre')).toBe('<h2>Titre</h2>');
  });

  it('connaît le gras et les liens dans un titre', () => {
    expect(prose('## Des **garde-fous** en [dollars](/fr/mentions)')).toBe(
      '<h2>Des <strong>garde-fous</strong> en <a href="/fr/mentions" rel="nofollow noopener noreferrer">dollars</a></h2>'
    );
  });

  it('laisse en texte un dièse seul, quatre dièses, un dièse collé, sans texte ou fait de dièses', () => {
    expect(prose('# Titre')).toBe('<p># Titre</p>');
    expect(prose('#### Titre')).toBe('<p>#### Titre</p>');
    expect(prose('##Titre')).toBe('<p>##Titre</p>');
    expect(prose('##')).toBe('<p>##</p>');
    expect(prose('## ')).toBe('<p>##</p>');
    // Un titre qui ne serait fait que de dièses : un paragraphe, pas un `h2` vide.
    expect(prose('## ##')).toBe('<p>## ##</p>');
    expect(prose('## #')).toBe('<p>## #</p>');
    expect(prose('### ###')).toBe('<p>### ###</p>');
  });

  it('ne reconnaît aucun titre sans lʼoption : le panneau et lʼadmin rendent `##` en texte', () => {
    expect(html('## Une section')).toBe('<p>## Une section</p>');
    expect(html('Intro.\n## Section\nSuite.')).toBe('<p>Intro.\n## Section\nSuite.</p>');
    expect(html('## Une section', {links: true})).toBe('<p>## Une section</p>');
    expect(html('## Une section', {headings: false})).toBe('<p>## Une section</p>');
  });
});

describe('liens sûrs (story 9)', () => {
  const rel = 'rel="nofollow noopener noreferrer"';

  it('rend un lien `https://` et `http://` absolu, avec `rel` et sans `target`', () => {
    expect(prose('voir [le code](https://exemple.invalid/depot) ici')).toBe(
      `<p>voir <a href="https://exemple.invalid/depot" ${rel}>le code</a> ici</p>`
    );
    expect(prose('[x](http://exemple.invalid)')).toBe(`<p><a href="http://exemple.invalid" ${rel}>x</a></p>`);
    expect(prose('[x](HTTPS://exemple.invalid)')).toBe(`<p><a href="HTTPS://exemple.invalid" ${rel}>x</a></p>`);
    expect(prose('[x](https://exemple.invalid)')).not.toContain('target=');
  });

  it('rend un chemin du site, ancre et requête comprises', () => {
    expect(prose('les [mentions légales](/fr/mentions).')).toBe(
      `<p>les <a href="/fr/mentions" ${rel}>mentions légales</a>.</p>`
    );
    expect(prose('[contact](/fr#contact)')).toBe(`<p><a href="/fr#contact" ${rel}>contact</a></p>`);
    expect(prose('[x](/en/comment?y=1)')).toBe(`<p><a href="/en/comment?y=1" ${rel}>x</a></p>`);
    expect(prose('[x](/)')).toBe(`<p><a href="/" ${rel}>x</a></p>`);
  });

  it('rend un lien dans un item de liste, et le gras dans un texte de lien', () => {
    expect(prose('- [**a** b](/fr)')).toBe(`<ul><li><a href="/fr" ${rel}><strong>a</strong> b</a></li></ul>`);
    expect(prose('**[gras](/fr)**')).toBe(`<p><strong><a href="/fr" ${rel}>gras</a></strong></p>`);
  });

  it.each([
    ['mailto:', '[x](mailto:a@exemple.invalid)'],
    ['javascript:', '[x](javascript:alert(1))'],
    ['JavaScript: en capitales', '[x](JAVASCRIPT:alert(1))'],
    ['data:', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['ftp://', '[x](ftp://exemple.invalid)'],
    ['tel:', '[x](tel:+41000000000)'],
    ['une adresse relative au protocole', '[x](//exemple.invalid)'],
    // Le navigateur normalise `\\` en `/` : `/\\evil.com` mènerait à `//evil.com`.
    ['une barre oblique inverse après la barre', '[x](/\\evil.com)'],
    ['une barre oblique inverse au milieu', '[x](/fr\\mentions)'],
    ['une barre oblique inverse dans une adresse absolue', '[x](https://exemple.invalid/a\\b)'],
    // Un caractère de contrôle se laisse ignorer par l'analyseur d'URL.
    ['une tabulation', '[x](/fr\tmentions)'],
    ['un caractère nul', `[x](/fr${String.fromCharCode(0)}mentions)`],
    ['un retour chariot', `[x](https://exemple.invalid/${String.fromCharCode(13)}x)`],
    ['DEL', `[x](/fr${String.fromCharCode(127)})`],
    ['un chemin relatif', '[x](page.html)'],
    ['un chemin avec une espace', '[x](/fr/une page)'],
    ['une adresse vide', '[x]()'],
    ['un texte vide', '[](/fr)'],
    ['une parenthèse jamais fermée', '[x](/fr'],
    ['un crochet jamais fermé', '[x(/fr)'],
    ['une espace entre crochet et parenthèse', '[x] (/fr)']
  ])('laisse en texte %s', (_label, source) => {
    const rendu = prose(source);
    expect(rendu).not.toContain('<a ');
    expect(rendu).not.toContain('href');
    expect(rendu.startsWith('<p>')).toBe(true);
  });

  it('refuse une adresse portant une barre oblique inverse ou un caractère de contrôle, où que ce soit', () => {
    expect(isSafeHref('/fr/mentions')).toBe(true);
    expect(isSafeHref('https://exemple.invalid/x')).toBe(true);
    expect(isSafeHref('/\\evil.com')).toBe(false);
    expect(isSafeHref('\\evil.com')).toBe(false);
    expect(isSafeHref('/fr\\x')).toBe(false);
    expect(isSafeHref('https://exemple.invalid\\@evil.com')).toBe(false);
    for (const code of [0, 1, 9, 10, 13, 27, 31, 127]) {
      expect(isSafeHref(`/fr${String.fromCharCode(code)}x`), `code ${code}`).toBe(false);
      expect(isSafeHref(`https://exemple.invalid/${String.fromCharCode(code)}`), `code ${code}`).toBe(false);
    }
  });

  it('ne rend aucun lien sans lʼoption : le panneau et lʼadmin gardent `[texte](adresse)` en texte', () => {
    expect(html('voir [le code](https://exemple.invalid) ici')).toBe('<p>voir [le code](https://exemple.invalid) ici</p>');
    expect(html('[x](/fr/mentions)')).toBe('<p>[x](/fr/mentions)</p>');
    expect(html('[x](/fr/mentions)', {headings: true})).toBe('<p>[x](/fr/mentions)</p>');
    expect(html('[x](/fr/mentions)', {links: false})).toBe('<p>[x](/fr/mentions)</p>');
    // Une annonce collée peut en porter : rien n'y devient cliquable.
    expect(html('- Postuler : [ici](https://exemple.invalid/postuler)')).not.toContain('<a ');
  });

  it('ne ferme pas une emphase à lʼintérieur dʼun lien : le lien reste entier dans lʼitalique', () => {
    expect(prose('_a [b](/x_) c_')).toBe(`<p><em>a <a href="/x_" ${rel}>b</a> c</em></p>`);
    expect(prose('*a [b](https://exemple.invalid/x*y) c*')).toBe(
      `<p><em>a <a href="https://exemple.invalid/x*y" ${rel}>b</a> c</em></p>`
    );
    expect(prose('**a [b](/x**) c**')).toBe(`<p><strong>a <a href="/x**" ${rel}>b</a> c</strong></p>`);
    // Sans fermeture après le lien, rien ne s'ouvre : tout reste en texte, le lien compris.
    expect(prose('_a [b](/x_) c')).toBe(`<p>_a <a href="/x_" ${rel}>b</a> c</p>`);
    // Sans l'option, le lien est du texte et l'emphase se ferme comme avant.
    expect(html('_a [b](/x_) c_')).toBe('<p><em>a [b](/x</em>) c_</p>');
  });

  it('nʼimbrique jamais un lien dans un lien', () => {
    expect(prose('[a [b](/x) c](/y)')).toBe(`<p>[a <a href="/x" ${rel}>b</a> c](/y)</p>`);
  });

  it('échappe une adresse qui tente de sortir de lʼattribut, et refuse une parenthèse', () => {
    const rendu = prose('[x](/fr"onmouseover="alert)');
    expect(rendu).toBe(`<p><a href="/fr&quot;onmouseover=&quot;alert" ${rel}>x</a></p>`);
    expect(rendu).not.toContain('"onmouseover=');
    // Une parenthèse ferme le lien : ce qui la porte n'est pas une adresse.
    expect(prose('[x](/fr"onmouseover="alert(1))')).toBe('<p>[x](/fr&quot;onmouseover=&quot;alert(1))</p>');
  });

  it('nʼest jamais une image', () => {
    expect(prose('![photo](https://exemple.invalid/x.jpg)')).toBe('<p>![photo](https://exemple.invalid/x.jpg)</p>');
  });
});

describe('tout le reste est du texte', () => {
  it.each([
    ['un titre de premier niveau', '# Titre', '<p># Titre</p>'],
    ['une citation', '> citée', '<p>&gt; citée</p>'],
    ['du code', 'appeler `f()`', '<p>appeler `f()`</p>'],
    ['un lien mailto', '[site](mailto:x@exemple.invalid)', '<p>[site](mailto:x@exemple.invalid)</p>'],
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
      fileURLToPath(new URL('../../src/app/(site)/[locale]/_components/markdown.tsx', import.meta.url)),
      'utf8'
    );
    // L'attribut posé, pas le mot dans un commentaire.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
  });
});
