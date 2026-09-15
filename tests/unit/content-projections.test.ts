/**
 * AD-8 — les deux projections, champ par champ.
 *
 * Ce fichier vérifie ce que les projections **contiennent** et comment elles
 * résolvent le bilinguisme ; `projection-leak.test.ts` vérifie ce qu'elles ne
 * contiennent pas. Les deux sont nécessaires : une liste blanche correcte mais
 * mal appliquée passerait le premier test et pas le second, et inversement.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {
  absoluteUrl,
  ageFrom,
  buildProjections,
  resolveList,
  resolveText
} from '@/content/projections';
import {cvSchema} from '@/content/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));
const cv = cvSchema.parse(parse(readFileSync(FIXTURE, 'utf8')));

/** Date fixe : l'âge projeté ne doit pas dépendre du jour où le test tourne. */
const NOW = new Date('2026-09-08T12:00:00Z');
const fr = buildProjections(cv, 'fr', {hasPhoto: true, now: NOW});
const en = buildProjections(cv, 'en', {hasPhoto: true, now: NOW});

describe('résolution bilingue', () => {
  it('rend la chaîne telle quelle quand le champ n’est pas une paire', () => {
    expect(resolveText('Villeneuve-Imaginaire', 'en')).toBe('Villeneuve-Imaginaire');
  });

  it('choisit la langue demandée quand le champ est une paire', () => {
    expect(resolveText({fr: 'Congé parental', en: 'Parental leave'}, 'en')).toBe('Parental leave');
  });

  it('replie sur le français plutôt que de rendre du vide', () => {
    expect(resolveText({fr: 'Congé parental', en: ''}, 'en')).toBe('Congé parental');
    expect(resolveList({fr: ['Un'], en: []}, 'en')).toEqual([]);
  });

  it('résout les listes comme les textes', () => {
    expect(resolveList(['Un', 'Deux'], 'en')).toEqual(['Un', 'Deux']);
    expect(resolveList({fr: ['Un'], en: ['One']}, 'en')).toEqual(['One']);
  });

  it("applique la résolution jusqu'aux feuilles des deux projections", () => {
    expect(fr.display.identite.titre).toBe('Développeuse logiciel');
    expect(en.display.identite.titre).toBe('Software developer');
    expect(fr.agent.competences[2]!.items).toEqual(['Revue croisée', 'Tests automatisés']);
    expect(en.agent.competences[2]!.items).toEqual(['Cross review', 'Automated testing']);
    expect(en.display.experiences[1]!.lieu).toBe('Parental leave');
  });
});

describe('âge calculé', () => {
  it("accompagne la date de naissance, comme le CV PDF (AD-8)", () => {
    expect(fr.display.identite.date_naissance).toBe('1988-04-12');
    expect(fr.display.identite.age).toBe(38);
    expect(fr.agent.identite.age).toBe(38);
  });

  it("n'a pas encore compté l'anniversaire de l'année en cours", () => {
    expect(ageFrom('1988-04-12', new Date('2026-04-11T12:00:00Z'))).toBe(37);
    expect(ageFrom('1988-04-12', new Date('2026-04-12T12:00:00Z'))).toBe(38);
  });

  it('renonce plutôt que d’inventer quand la date est incomplète', () => {
    expect(ageFrom('1988', NOW)).toBeUndefined();
  });
});

describe('projection display — ce que la page reçoit', () => {
  it("porte l'identité et le contact publiables", () => {
    expect(fr.display.identite.prenom).toBe('Camille');
    expect(fr.display.contact.email).toBe('camille.durand@exemple.invalid');
    expect(fr.display.contact.linkedin).toBeDefined();
  });

  it('annonce la photo par sa présence, jamais par son chemin', () => {
    expect(fr.display.identite.photo).toBe(true);
    expect(buildProjections(cv, 'fr', {hasPhoto: false, now: NOW}).display.identite.photo).toBe(false);
  });

  it('retient les formations `dans_cv: true` et laisse les autres', () => {
    expect(fr.display.formation.map((entry) => entry.id)).toEqual(['diplome-fictif']);
  });

  it('porte la localité et lʼoption du diplôme, dans la langue demandée', () => {
    // La localité est un champ à part : rien n'est tiré de `contact.adresse`.
    expect(fr.display.contact.localite).toBe('Bourgade-Fictive (Contrée)');
    expect(fr.display.formation[0]!.option).toBe('Option fictive');
    expect(en.display.formation[0]!.option).toBe('Fictional option');
  });

  it("n'a ni certificats de travail, ni arguments de lettre, ni références", () => {
    expect(fr.display).not.toHaveProperty('certificats_travail');
    expect(fr.display).not.toHaveProperty('lettre_motivation');
    expect(fr.display).not.toHaveProperty('references');
  });
});

describe('projection agent — ce que le modèle reçoit', () => {
  it('reçoit toute la formation, `dans_cv: false` comprise (AD-8)', () => {
    expect(fr.agent.formation.map((entry) => entry.id)).toEqual([
      'diplome-fictif',
      'certificat-annexe'
    ]);
  });

  it('reçoit les certificats de travail et les arguments de la lettre', () => {
    expect(fr.agent.certificats_travail).toHaveLength(2);
    expect(fr.agent.certificats_travail[1]!.fonction_attestee).toBe('développeuse');
    expect(fr.agent.certificats_travail[1]!.points_cles).toEqual([
      'Facturation fictive reprise de bout en bout.'
    ]);
    expect(fr.agent.lettre_motivation?.arguments_cles).toHaveLength(2);
  });

  it("ne reçoit pas de photo : elle n'a rien à dire au modèle", () => {
    expect(fr.agent.identite).not.toHaveProperty('photo');
  });
});

describe('clés de citation cv: — AD-4', () => {
  it('nomme chaque nœud de la projection agent', () => {
    expect(fr.agent.identite.source).toBe('cv:identite');
    expect(fr.agent.contact.source).toBe('cv:contact');
    expect(fr.agent.profil.source).toBe('cv:profil');
    expect(fr.agent.langues.source).toBe('cv:langues');
    expect(fr.agent.atouts.source).toBe('cv:atouts');
    expect(fr.agent.lettre_motivation?.source).toBe('cv:lettre_motivation');
  });

  it('dérive les clés des identifiants du fichier', () => {
    expect(fr.agent.experiences.map((entry) => entry.source)).toEqual([
      'cv:experiences.outillage-interne',
      'cv:experiences.conge-parental',
      'cv:experiences.applications-gestion'
    ]);
    expect(fr.agent.formation.map((entry) => entry.source)).toEqual([
      'cv:formation.diplome-fictif',
      'cv:formation.certificat-annexe'
    ]);
  });

  it('reste identique dans les deux langues : une citation désigne un nœud', () => {
    const keys = (projections: typeof fr) => [
      ...projections.agent.competences.map((entry) => entry.source),
      ...projections.agent.certificats_travail.map((entry) => entry.source)
    ];
    expect(keys(en)).toEqual(keys(fr));
    expect(fr.agent.competences[0]!.source).toBe('cv:competences.langages-fictifs');
    expect(fr.agent.certificats_travail[0]!.source).toBe(
      'cv:certificats_travail.certificat-societe-fictive'
    );
  });

  it("ne dépend ni du libellé ni de la position — c'est le sens de « stable »", () => {
    // Une clé dérivée du libellé bougerait au premier renommage ; dérivée de la
    // position, elle changerait de nœud à la première inversion. Ni l'un ni l'autre.
    const raw = parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    const remanié = cvSchema.parse({
      ...raw,
      competences: [...(raw.competences as unknown[])].reverse().map((entry, index) => ({
        ...(entry as Record<string, unknown>),
        categorie: `Libellé réécrit ${index}`
      }))
    });
    const clés = buildProjections(remanié, 'fr', {hasPhoto: false, now: NOW}).agent.competences.map(
      (entry) => entry.source
    );
    expect(clés).toEqual([...fr.agent.competences.map((entry) => entry.source)].reverse());
  });
});

describe('normalisation des adresses de profil', () => {
  it('rend absolue une adresse écrite sans schéma', () => {
    // Servi tel quel dans un href, `linkedin.com/in/…` serait un lien **relatif**
    // vers une page du site, donc un lien mort.
    expect(fr.display.contact.linkedin).toBe(
      'https://linkedin.exemple.invalid/in/camille-durand-fictif'
    );
  });

  it("ne touche pas à une adresse déjà absolue, et n'invente rien sans valeur", () => {
    expect(absoluteUrl('https://exemple.invalid/x')).toBe('https://exemple.invalid/x');
    expect(absoluteUrl('http://exemple.invalid')).toBe('http://exemple.invalid');
    expect(absoluteUrl(undefined)).toBeUndefined();
    expect(absoluteUrl('')).toBeUndefined();
  });
});
