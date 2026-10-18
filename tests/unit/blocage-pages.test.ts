/**
 * Le garde du blocage (story 13) : **aucune page du site n'échappe au verdict**.
 *
 * Le dispositif repose sur un appel répété — `requireNotBlocked()` en tête de
 * chaque page —, et non sur un point de passage unique. Ce choix est expliqué
 * dans `src/app/_lib/visit.ts` : un `notFound()` levé par le layout `(site)`
 * chercherait sa frontière dans son propre enfant, et Next ne servirait qu'une
 * coquille que le navigateur doit remplir — donc rien sans JavaScript.
 *
 * Un appel répété s'oublie. C'est ce test qui l'empêche : une page ajoutée
 * demain sous `(site)` sans son appel fait échouer la suite, avec son nom.
 *
 * Une page peut satisfaire le garde de deux façons : appeler elle-même, ou
 * passer par `prosePage()` — la fabrique des deux pages de prose, qui appelle
 * pour elles. La fabrique est donc vérifiée à part, et nommément.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const SITE = fileURLToPath(new URL('../../src/app/(site)', import.meta.url));
const FABRIQUE = join(SITE, '[locale]', '_components', 'prose-page.tsx');
const APPEL = 'requireNotBlocked()';

/** Tous les `page.tsx` du groupe `(site)`, chemins relatifs à lui, triés. */
function pagesDuSite(dossier: string = SITE, trouvees: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) pagesDuSite(chemin, trouvees);
    else if (entree === 'page.tsx') trouvees.push(chemin);
  }
  return trouvees.sort();
}

const nom = (chemin: string) => relative(SITE, chemin).split(sep).join('/');

describe('le verdict de blocage couvre tout le site', () => {
  const pages = pagesDuSite();

  it('a bien des pages à contrôler', () => {
    // La liste est écrite : une page qui disparaît est aussi un changement à
    // regarder, pas seulement une page qui apparaît.
    expect(pages.map(nom)).toEqual(['[locale]/comment/page.tsx', '[locale]/mentions/page.tsx', '[locale]/page.tsx']);
  });

  it.each(pages.map((chemin) => [nom(chemin), chemin]))(
    '%s demande le verdict, directement ou par la fabrique de pages de prose',
    (_nom, chemin) => {
      const source = readFileSync(chemin, 'utf8');
      const directement = source.includes(APPEL);
      const parLaFabrique = /\bprosePage\(/.test(source);

      expect(
        directement || parLaFabrique,
        `cette page ne demande pas le verdict : ajouter « await ${APPEL} » en tête, avant tout contenu`
      ).toBe(true);
    }
  );

  it('la fabrique des pages de prose le demande pour les deux pages quʼelle produit', () => {
    expect(readFileSync(FABRIQUE, 'utf8')).toContain(APPEL);
  });

  it('le demande **avant** de projeter le contenu : un bloqué nʼa rien à charger', () => {
    for (const chemin of [...pages, FABRIQUE]) {
      const source = readFileSync(chemin, 'utf8');
      const verdict = source.indexOf(APPEL);
      const contenu = source.indexOf("import('@/content')");
      if (verdict === -1 || contenu === -1) continue;
      expect(verdict, `${nom(chemin)} : le verdict doit précéder la lecture du contenu`).toBeLessThan(contenu);
    }
  });

  it('les quatre routes qui servent du contenu refusent un bloqué', () => {
    // Les documents lèvent `notFound()` ; les routes rendent un `404` nu, par
    // `blockedResponse()`. Les deux chemins doivent être couverts, sinon
    // l'assistant — ou la photo — resterait ouvert à quelqu'un qui n'a plus le
    // CV. `/api/photo` est de la liste depuis la revue de la story 13 : elle
    // sert une donnée personnelle, et une adresse connue suffit à la demander
    // hors de la page.
    const ROUTES = fileURLToPath(new URL('../../src/app', import.meta.url));
    for (const chemin of [
      join(ROUTES, '_lib', 'stream-route.ts'),
      join(ROUTES, '_lib', 'contact-route.ts'),
      join(ROUTES, 'api', 'questions', '[id]', 'route.ts'),
      join(ROUTES, 'api', 'photo', 'route.ts')
    ]) {
      const source = readFileSync(chemin, 'utf8');
      expect(source, chemin).toContain('blockedResponse()');
      // `requestBlocked(...)` et **non** `visit?.blocked` : sans cookie,
      // `recordVisit` rend `null`, et le test de la propriété serait
      // `undefined` — la route s'ouvrirait à qui efface ses cookies. La revue
      // de la story 13 a trouvé le trou ; ce garde empêche de le rouvrir.
      expect(source, chemin).toMatch(/await requestBlocked\(/);
      expect(source, chemin).not.toMatch(/if \(visit\??\.blocked\)/);
    }
  });
});
