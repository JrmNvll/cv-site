/**
 * AD-8 — **le test qui compte.**
 *
 * Le reste de la suite dit que les projections contiennent ce qu'il faut. Celui-ci
 * dit qu'elles ne contiennent rien d'autre : ni l'adresse, ni le téléphone, ni
 * une donnée de tiers, ni un chemin interne. C'est la garantie qui tient toute
 * la story — un champ ajouté demain à `cv.yaml` sans être ajouté à la liste
 * blanche fait échouer ici, et nulle part ailleurs.
 *
 * La méthode : les chemins ci-dessous sont la colonne « non / non » d'AD-8. Le
 * test lit leurs **valeurs réelles dans la fixture**, puis cherche chacune dans
 * le texte des deux projections, dans les deux langues. Rien n'est comparé à une
 * liste écrite à la main : changer la fixture change automatiquement ce qui est
 * cherché.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {buildProjections} from '@/content/projections';
import {cvSchema, LANGS} from '@/content/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));
const raw = parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
const cv = cvSchema.parse(raw);

const NOW = new Date('2026-09-08T12:00:00Z');
const projections = Object.fromEntries(
  LANGS.map((lang) => [lang, buildProjections(cv, lang, {hasPhoto: true, now: NOW})])
);

/**
 * Colonne « non / non » d'AD-8, plus les chemins de fichiers. `[]` traverse un
 * tableau ; un chemin sans suffixe emporte tout son sous-arbre.
 */
const HORS_LISTE_BLANCHE = [
  'meta',
  'identite.prenoms_etat_civil',
  'identite.lieu_naissance',
  'identite.photo',
  'contact.telephone',
  'contact.adresse',
  'references',
  'certificats_travail[].signataire',
  'certificats_travail[].fichier',
  'formation[].justificatif',
  'lettre_motivation.fichier',
  'lettre_motivation.type'
] as const;

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
 * Valeurs à ne jamais retrouver.
 *
 * Le seuil est haut — huit caractères — et c'est délibéré : une sentinelle
 * courte (`fr`, `0000`) finirait par apparaître dans une valeur projetée en
 * toute innocence, et ferait échouer pour rien le test dont tout dépend. La
 * fixture donne donc à chaque champ hors liste blanche une valeur longue et
 * unique, et `SENTINELLE_MIN` refuse de chercher ce qui ne prouverait rien.
 */
const SENTINELLE_MIN = 8;
const sentinelles = [
  ...new Set(
    HORS_LISTE_BLANCHE.flatMap((path) => at(raw, path).flatMap((node) => strings(node))).filter(
      (value) => value.length >= SENTINELLE_MIN
    )
  )
];

describe('aucun champ hors liste blanche ne sort', () => {
  it('trouve bien des sentinelles à chercher — sinon le test ne prouve rien', () => {
    expect(sentinelles.length).toBeGreaterThanOrEqual(12);
    expect(sentinelles.every((value) => value.length >= SENTINELLE_MIN)).toBe(true);
  });

  it('couvre chaque chemin hors liste blanche : aucun ne doit être muet', () => {
    // Un chemin dont la fixture n'aurait aucune valeur assez longue serait
    // silencieusement retiré de la recherche, et le champ ne serait plus testé.
    const muets = HORS_LISTE_BLANCHE.filter(
      (path) =>
        !at(raw, path)
          .flatMap((node) => strings(node))
          .some((value) => value.length >= SENTINELLE_MIN)
    );
    expect(muets).toEqual([]);
  });

  it.each(LANGS)('projection display (%s) — aucune sentinelle', (lang) => {
    const texte = JSON.stringify(projections[lang]!.display);
    expect(sentinelles.filter((value) => texte.includes(value))).toEqual([]);
  });

  it.each(LANGS)('projection agent (%s) — aucune sentinelle', (lang) => {
    const texte = JSON.stringify(projections[lang]!.agent);
    expect(sentinelles.filter((value) => texte.includes(value))).toEqual([]);
  });

  it('cherche bien ce qu’il dit chercher', () => {
    // Sonde : si la recherche était inopérante, ce test-ci passerait aussi.
    expect(sentinelles).toContain('Camille-Alix-EtatCivilFictif');
    expect(sentinelles).toContain('+41 00 000 00 07');
    expect(sentinelles).toContain('Signataire-CertificatFictif');
    expect(sentinelles).toContain('dossier-fictif/diplome-fictif.pdf');
    expect(sentinelles).toContain('Referente-Fictive-Personne');
    expect(JSON.stringify(projections.fr!.display)).toContain('Camille');
  });
});

describe('aucun champ hors liste blanche par sa clé non plus', () => {
  it.each(LANGS)('display (%s) ne porte aucune clé interdite', (lang) => {
    const {identite, contact} = projections[lang]!.display;
    expect(Object.keys(identite).sort()).toEqual(
      ['age', 'date_naissance', 'nationalite', 'nom', 'photo', 'prenom', 'sous_titre', 'titre'].sort()
    );
    expect(Object.keys(contact).sort()).toEqual(['email', 'linkedin', 'localite'].sort());
  });

  it.each(LANGS)('agent (%s) ne porte ni photo ni téléphone', (lang) => {
    const {identite, contact} = projections[lang]!.agent;
    expect(Object.keys(identite)).not.toContain('photo');
    expect(Object.keys(contact).sort()).toEqual(['email', 'linkedin', 'localite', 'source'].sort());
  });

  it("n'expose ni les signataires ni les fichiers des certificats", () => {
    for (const certificat of projections.fr!.agent.certificats_travail) {
      expect(Object.keys(certificat).sort()).toEqual(
        ['date', 'entreprise', 'fonction_attestee', 'id', 'periode_attestee', 'points_cles', 'source'].sort()
      );
    }
  });
});

describe('un champ ajouté à cv.yaml ne sort pas de lui-même', () => {
  it('ignore une clé inconnue même quand elle vaut une donnée sensible', () => {
    const augmente = cvSchema.parse({
      ...raw,
      identite: {...(raw.identite as object), avs: 'SentinelleAVS-Fictive-756'},
      contact: {...(raw.contact as object), telephone_prive: 'SentinelleTelPrive-Fictif'}
    });
    const texte = LANGS.map((lang) => {
      const built = buildProjections(augmente, lang, {hasPhoto: true, now: NOW});
      return JSON.stringify(built.display) + JSON.stringify(built.agent);
    }).join('');
    expect(texte).not.toContain('SentinelleAVS-Fictive-756');
    expect(texte).not.toContain('SentinelleTelPrive-Fictif');
  });
});
