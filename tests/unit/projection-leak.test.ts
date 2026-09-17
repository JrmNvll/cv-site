/**
 * AD-8 — **le test qui compte.**
 *
 * Le reste de la suite dit que les projections contiennent ce qu'il faut. Celui-ci
 * dit qu'elles ne contiennent rien d'autre : ni l'adresse, ni le téléphone, ni
 * une donnée de tiers, ni un chemin interne. C'est la garantie qui tient toute
 * la story — un champ ajouté demain à `cv.yaml` sans être ajouté à la liste
 * blanche fait échouer ici, et nulle part ailleurs.
 *
 * La méthode : les chemins de `sentinelles.ts` sont la colonne « non / non »
 * d'AD-8. Le test lit leurs **valeurs réelles dans la fixture**, puis cherche
 * chacune dans le texte des deux projections, dans les deux langues. Rien n'est
 * comparé à une liste écrite à la main : changer la fixture change
 * automatiquement ce qui est cherché. Les mêmes sentinelles servent au noyau
 * du modèle (`knowledge.test.ts`) : une seule liste, pas deux à faire diverger.
 */
import {describe, expect, it} from 'vitest';
import {buildProjections} from '@/content/projections';
import {cvSchema, LANGS} from '@/content/schema';
import {at, HORS_LISTE_BLANCHE, rawCv as raw, SENTINELLE_MIN, sentinelles, strings} from './sentinelles';

const cv = cvSchema.parse(raw);

const NOW = new Date('2026-09-08T12:00:00Z');
const projections = Object.fromEntries(
  LANGS.map((lang) => [lang, buildProjections(cv, lang, {hasPhoto: true, now: NOW})])
);

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
    expect(sentinelles).toContain('+41 00 000 00 08');
    expect(sentinelles).toContain('referente-fictive@exemple.invalid');
    expect(JSON.stringify(projections.fr!.display)).toContain('Camille');
  });
});

describe('aucun champ hors liste blanche par sa clé non plus', () => {
  it.each(LANGS)('display (%s) ne porte aucune clé interdite', (lang) => {
    const {identite, contact} = projections[lang]!.display;
    expect(Object.keys(identite).sort()).toEqual(
      ['age', 'date_naissance', 'nationalite', 'nom', 'photo', 'prenom', 'sous_titre', 'titre'].sort()
    );
    // Le courriel n'est plus dans ce que la page reçoit : il sort par une route.
    expect(Object.keys(contact).sort()).toEqual(['github', 'linkedin', 'localite'].sort());
  });

  it.each(LANGS)('display (%s) ne porte pas le courriel — le modèle, si', (lang) => {
    expect(JSON.stringify(projections[lang]!.display)).not.toContain('camille.durand@exemple.invalid');
    expect(projections[lang]!.agent.contact.email).toBe('camille.durand@exemple.invalid');
  });

  it.each(LANGS)('agent (%s) ne porte ni photo ni téléphone', (lang) => {
    const {identite, contact} = projections[lang]!.agent;
    expect(Object.keys(identite)).not.toContain('photo');
    expect(Object.keys(contact).sort()).toEqual(['email', 'github', 'linkedin', 'localite', 'source'].sort());
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
