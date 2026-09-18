import {expect, test} from '@playwright/test';
import {rawCv, LANGS} from './fixture-cv';

/**
 * AD-8, vérifié sur le **document réellement servi** — le pendant navigateur de
 * `tests/unit/projection-leak.test.ts`.
 *
 * L'unitaire prouve que les projections ne portent pas les champs hors liste
 * blanche. Celui-ci prouve la même chose une couche plus loin, là où le risque
 * change de nature : un composant pourrait recopier une valeur, un accessoire de
 * composant client pourrait la sérialiser dans la charge utile RSC, une route
 * pourrait la mettre dans un en-tête. Rien de tout cela ne se verrait en
 * unitaire.
 *
 * La méthode est celle de l'unitaire : les chemins ci-dessous sont la colonne
 * « non / non » d'AD-8, leurs **valeurs réelles dans la fixture** deviennent les
 * sentinelles, et on les cherche dans le HTML. Rien n'est comparé à une liste
 * écrite à la main : changer la fixture change ce qui est cherché.
 */
const HORS_HTML = [
  'meta',
  'identite.prenoms_etat_civil',
  'identite.lieu_naissance',
  'identite.photo',
  'contact.telephone',
  // Le courriel aussi, depuis le 2026-09-15 : une route, sur geste explicite.
  'contact.email',
  'contact.adresse',
  // Nom et fonction d'une référence s'affichent ; ses coordonnées, jamais.
  'references[].telephone',
  'references[].email',
  'certificats_travail[].signataire',
  'certificats_travail[].fichier',
  'certificats_travail[].periode_attestee',
  'formation[].justificatif',
  'lettre_motivation.fichier',
  'lettre_motivation.type',
  'lettre_motivation.arguments_cles'
] as const;

/**
 * Le HTML servi échappe ce qu'il rend : `'` devient `&#x27;`, `"` devient
 * `&quot;`, et la charge utile RSC écrit `<` en `\u003c`. Une sentinelle qui
 * porte l'un de ces caractères ne se trouverait pas telle quelle. On ramène
 * le document à sa forme lisible avant de chercher.
 */
function deseschappe(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;|\\u003c/g, '<')
    .replace(/&gt;|\\u003e/g, '>')
    .replace(/&amp;/g, '&');
}

/** Toutes les chaînes d'un sous-arbre, quelle que soit sa profondeur. */
function strings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') found.push(node);
  else if (typeof node === 'number') found.push(String(node));
  else if (Array.isArray(node)) node.forEach((item) => strings(item, found));
  else if (node !== null && typeof node === 'object') {
    Object.values(node).forEach((item) => strings(item, found));
  }
  return found;
}

/** Suit un chemin, en dépliant les tableaux marqués `[]`. */
function at(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const step of path.split('.')) {
    const key = step.replace('[]', '');
    const spread = step.endsWith('[]');
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== 'object') continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (spread && Array.isArray(value)) next.push(...value);
      else next.push(value);
    }
    current = next;
  }
  return current;
}

/**
 * Seuil identique à celui de l'unitaire, et pour la même raison : une sentinelle
 * courte finirait par apparaître dans une classe CSS ou un identifiant React, et
 * ferait échouer pour rien le test dont tout dépend.
 */
const SENTINELLE_MIN = 8;
const sentinelles = [
  ...new Set(
    HORS_HTML.flatMap((path) => at(rawCv, path).flatMap((node) => strings(node))).filter(
      (value) => value.length >= SENTINELLE_MIN
    )
  )
];

test('trouve bien des sentinelles à chercher — sinon le test ne prouve rien', () => {
  expect(sentinelles.length).toBeGreaterThanOrEqual(12);
  // Sonde : si la recherche était inopérante, ce test-ci passerait aussi.
  expect(sentinelles).toContain('+41 00 000 00 07');
  expect(sentinelles).toContain('+41 00 000 00 08');
  expect(sentinelles).toContain('referente-fictive@exemple.invalid');
  expect(sentinelles).toContain('Signataire-CertificatFictif');
  expect(sentinelles).toContain('dossier-fictif/diplome-fictif.pdf');
});

test('couvre chaque chemin hors HTML : aucun ne doit être muet', () => {
  const muets = HORS_HTML.filter(
    (path) =>
      !at(rawCv, path)
        .flatMap((node) => strings(node))
        .some((value) => value.length >= SENTINELLE_MIN)
  );
  expect(muets).toEqual([]);
});

/**
 * La page CV et, depuis la story 9, les deux pages de prose — qui portent la
 * même barre (le nom) et, sur les mentions, le bouton du courriel : le
 * courriel y reste hors du HTML comme partout ailleurs (AD-8).
 */
const DOCUMENTS = ['', '/comment', '/mentions'] as const;

for (const locale of LANGS) {
  for (const chemin of DOCUMENTS) {
    test(`/${locale}${chemin} ne sert ni téléphone, ni courriel, ni adresse, ni tiers, ni chemin de fichier`, async ({
      request
    }) => {
      const reponse = await request.get(`/${locale}${chemin}`);
      expect(reponse.status()).toBe(200);
      const html = deseschappe(await reponse.text());

      expect(sentinelles.filter((value) => html.includes(value))).toEqual([]);
    });

    test(`/${locale}${chemin} ne divulgue pas lʼarborescence du contenu privé`, async ({request}) => {
      const html = await (await request.get(`/${locale}${chemin}`)).text();

      // Ni le répertoire de contenu, ni le chemin de la photo, ni la moindre
      // arborescence de fichier : la photo passe par `/api/photo`, et rien d'autre.
      // Le chemin Windows sous ses deux formes : brut, et échappé dans du JSON.
      for (const trace of [
        'CONTENT_DIR',
        'fixtures/content',
        'fixtures\\content',
        'fixtures\\\\content',
        'assets/'
      ]) {
        expect(html, `« ${trace} » ne doit pas figurer dans le document`).not.toContain(trace);
      }
      // La photo n'est que sur la page CV ; les pages de prose n'en montrent pas.
      if (chemin === '') expect(html).toContain('/api/photo');
      else expect(html).not.toContain('/api/photo');
    });
  }
}

test('les en-têtes des routes ne portent rien non plus', async ({request}) => {
  for (const chemin of ['/api/photo', '/api/contact/phone', '/fr']) {
    const reponse = await request.get(chemin);
    const entetes = JSON.stringify(reponse.headers());
    expect(
      sentinelles.filter((value) => entetes.includes(value)),
      `en-têtes de ${chemin}`
    ).toEqual([]);
  }
});
