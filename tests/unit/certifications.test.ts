/**
 * La rubrique « Certificat » — story 14, la matrice de la spec, ligne par ligne.
 *
 * Ce que ce fichier garde, au-delà des champs : la section `certifications` et
 * la section `certificats_travail` portent deux mots proches et deux objets sans
 * rapport. L'une s'affiche avec un lien public ; l'autre est une attestation
 * d'employeur dont le signataire ne sort d'aucune projection (AD-8). Un test qui
 * les confondrait laisserait passer précisément la faute qu'on veut empêcher.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {buildProjections} from '@/content/projections';
import {cvSchema} from '@/content/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));
const brut = parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
const cv = cvSchema.parse(brut);

const NOW = new Date('2026-09-08T12:00:00Z');
const fr = buildProjections(cv, 'fr', {hasPhoto: true, now: NOW});

/** La fixture telle quelle, moins une section — pour éprouver son absence. */
function sans(section: string): Record<string, unknown> {
  const copie = structuredClone(brut);
  delete copie[section];
  return copie;
}

// L'unicité et la présence des `id` sont éprouvées par les tables génériques de
// `content-schema.test.ts`, qui couvrent les cinq familles citables d'un coup :
// les y laisser évite qu'une famille de plus hérite d'un doublon de plus.
describe('le schéma', () => {
  it('accepte la section absente : une certification est un ajout, pas un dû', () => {
    const parsed = cvSchema.safeParse(sans('certifications'));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.certifications).toBeUndefined();
  });

  it('refuse une adresse de vérification qui nʼen est pas une', () => {
    const casse = structuredClone(brut) as {certifications: {verification: string}[]};
    casse.certifications[0]!.verification = 'javascript:alert(1)';
    const parsed = cvSchema.safeParse(casse);
    expect(parsed.success).toBe(false);
    // Le message doit nommer le champ : une erreur de démarrage sert à corriger
    // le fichier, pas à deviner lequel des trente champs est en cause.
    expect(JSON.stringify(parsed.error?.issues)).toContain('verification');
  });

  it('exige un intitulé et un organisme non vides', () => {
    for (const champ of ['intitule', 'organisme'] as const) {
      const casse = structuredClone(brut) as {certifications: Record<string, unknown>[]};
      casse.certifications[0]![champ] = '';
      expect(cvSchema.safeParse(casse).success, champ).toBe(false);
    }
  });
});

describe('les deux projections', () => {
  it('sert à la page lʼintitulé, lʼorganisme, la date et lʼadresse absolue', () => {
    const [premiere] = fr.display.certifications;
    expect(premiere).toEqual({
      id: 'certification-fictive',
      intitule: 'Certification Fictive En Outillage',
      organisme: 'Organisme Certificateur Fictif',
      date: '2026-02-17',
      // Écrite sans schéma dans le fichier : servie en `https://`, comme les
      // profils. Telle quelle dans un `href`, elle deviendrait un chemin du site.
      verification: 'https://certif-fictif.example/verifier/abc123'
    });
  });

  it('retire de la page ce que `dans_cv: false` masque, et le garde pour lʼagent', () => {
    const affichees = fr.display.certifications.map((entry) => entry.id);
    const connues = fr.agent.certifications.map((entry) => entry.id);
    expect(affichees).toEqual(['certification-fictive', 'certification-fictive-sans-preuve']);
    expect(connues).toEqual([
      'certification-fictive',
      'certification-fictive-sans-preuve',
      'certification-fictive-masquee'
    ]);
  });

  it('donne au modèle une clé de citation par entrée', () => {
    expect(fr.agent.certifications.map((entry) => entry.source)).toEqual([
      'cv:certifications.certification-fictive',
      'cv:certifications.certification-fictive-sans-preuve',
      'cv:certifications.certification-fictive-masquee'
    ]);
  });

  it('omet lʼadresse plutôt que de la rendre vide quand elle manque', () => {
    const masquee = fr.agent.certifications.find(
      (entry) => entry.id === 'certification-fictive-masquee'
    )!;
    expect('verification' in masquee).toBe(false);
    expect('date' in masquee).toBe(false);
  });

  it('ne confond pas la rubrique avec les attestations dʼemployeur', () => {
    // Deux familles distinctes, deux préfixes de citation distincts : si l'une
    // avait été repliée sur l'autre, ce test le dirait.
    const certifications = fr.agent.certifications.map((entry) => entry.source);
    const attestations = fr.agent.certificats_travail.map((entry) => entry.source);
    expect(certifications.every((clef) => clef.startsWith('cv:certifications.'))).toBe(true);
    expect(attestations.every((clef) => clef.startsWith('cv:certificats_travail.'))).toBe(true);
    expect(certifications.some((clef) => attestations.includes(clef))).toBe(false);
    // Et la page ne reçoit aucune attestation : seule la rubrique s'affiche.
    expect('certificats_travail' in fr.display).toBe(false);
  });

  it('porte le même intitulé et le même organisme dans les deux langues', () => {
    // La décision de ne PAS localiser ces deux champs (ce sont des noms propres)
    // ne tenait qu'à un commentaire : ce test la verrouille. Si quelqu'un passe
    // `intitule` en `localizedText` et traduit une entrée, il tombe ici.
    const en = buildProjections(cv, 'en', {hasPhoto: true, now: NOW});
    expect(en.display.certifications).toEqual(fr.display.certifications);
    expect(en.agent.certifications).toEqual(fr.agent.certifications);
  });

  it('refuse un intitulé localisé : ce sont des noms propres', () => {
    const casse = structuredClone(brut) as {certifications: Record<string, unknown>[]};
    casse.certifications[0]!.intitule = {fr: 'Certification', en: 'Certification'};
    expect(cvSchema.safeParse(casse).success).toBe(false);
  });

  it('rend une liste vide, jamais `undefined`, quand la section manque', () => {
    const sansSection = buildProjections(cvSchema.parse(sans('certifications')), 'fr', {
      hasPhoto: true,
      now: NOW
    });
    // Le composant teste `.length === 0` : un `undefined` le ferait tomber.
    expect(sansSection.display.certifications).toEqual([]);
    expect(sansSection.agent.certifications).toEqual([]);
  });
});

describe('le composant de section', () => {
  const SOURCE = fileURLToPath(
    new URL('../../src/app/(site)/[locale]/_components/certifications-section.tsx', import.meta.url)
  );
  const source = readFileSync(SOURCE, 'utf8');

  it('ne rend rien quand la liste est vide — la page le rend sans condition', () => {
    // `page.tsx` monte la section sans la conditionner : sans ce garde, un CV
    // sans certification servirait un titre de rubrique suivi d'une liste vide.
    // Éprouvé en retirant la ligne : le test tombe.
    expect(source).toContain('if (certifications.length === 0) return null;');
  });

  it('ne re-filtre rien : la décision de montrer reste dans la projection (AD-8)', () => {
    // Le commentaire d'en-tête, lui, parle de `dans_cv` — et doit le faire.
    // Ce qui est interdit, c'est un filtre : il déplacerait la décision hors de
    // la liste blanche, là où aucun test de non-fuite ne la surveille.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/\.filter\(/);
    expect(code).not.toContain('dans_cv');
  });

  it('ouvre son lien sortant sans donner la main à la page visée', () => {
    expect(source).toContain("rel=\"noopener noreferrer\"");
    expect(source).toContain("target=\"_blank\"");
  });
});
