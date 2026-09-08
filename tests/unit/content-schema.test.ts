/**
 * AD-2 — le schéma de `cv.yaml`.
 *
 * Le fichier réel est la **référence** : ce qui y figure sous deux formes doit
 * être accepté sous ses deux formes, ce qui n'y figure pas est optionnel. Un
 * schéma trop strict ferait échouer le démarrage sur un contenu parfaitement
 * valide ; un schéma trop lâche laisserait passer une faute de frappe jusqu'à
 * la page.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {cvSchema, isCalendarDate} from '@/content/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));
const base = () => parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;

/** Copie un objet sans l'une de ses clés — sans variable inutilisée à ignorer. */
function sans<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {...value};
  delete copy[key];
  return copy;
}

/** Remplace une section de la fixture sans toucher au reste. */
function withSection(section: string, value: unknown) {
  return {...base(), [section]: value};
}

describe('cvSchema — la fixture', () => {
  it('accepte le fichier de fixture tel quel', () => {
    expect(cvSchema.safeParse(base()).success).toBe(true);
  });

  it("retire les champs qu'il ne connaît pas plutôt que de les propager", () => {
    const parsed = cvSchema.parse({
      ...base(),
      inconnu_racine: 'valeur inventée',
      identite: {...(base().identite as object), inconnu_identite: 'autre valeur'}
    });
    expect(parsed).not.toHaveProperty('inconnu_racine');
    expect(parsed.identite).not.toHaveProperty('inconnu_identite');
  });
});

describe('cvSchema — les deux formes des champs textuels', () => {
  it.each([
    ['une chaîne', 'Genève, Suisse'],
    ['une paire {fr, en}', {fr: 'Congé parental', en: 'Parental leave'}]
  ])('accepte %s pour `experiences[].lieu`', (_label, lieu) => {
    const experiences = (base().experiences as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      lieu
    }));
    expect(cvSchema.safeParse(withSection('experiences', experiences)).success).toBe(true);
  });

  it('refuse une paire incomplète : `{fr}` sans `en`', () => {
    const experiences = (base().experiences as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      lieu: {fr: 'Genève'}
    }));
    expect(cvSchema.safeParse(withSection('experiences', experiences)).success).toBe(false);
  });

  it.each([
    ['une liste simple', ['Un', 'Deux']],
    ['une paire de listes', {fr: ['Un'], en: ['One']}]
  ])('accepte %s pour `atouts`', (_label, atouts) => {
    expect(cvSchema.safeParse(withSection('atouts', atouts)).success).toBe(true);
  });

  it('accepte une année en nombre comme une date en chaîne', () => {
    const formation = (base().formation as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      annee: 2012
    }));
    expect(cvSchema.safeParse(withSection('formation', formation)).success).toBe(true);
  });
});

describe('cvSchema — ce qui est exigé', () => {
  it('exige un identifiant sur chaque expérience', () => {
    const experiences = (base().experiences as Record<string, unknown>[]).map((entry) => sans(entry, 'id'));
    const result = cvSchema.safeParse(withSection('experiences', experiences));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('id');
  });

  it('exige un identifiant sur chaque formation', () => {
    const formation = (base().formation as Record<string, unknown>[]).map((entry) => sans(entry, 'id'));
    expect(cvSchema.safeParse(withSection('formation', formation)).success).toBe(false);
  });

  it("refuse un identifiant qui ne pourrait pas servir de clé de citation", () => {
    const experiences = (base().experiences as Record<string, unknown>[]).map((entry, index) => ({
      ...entry,
      id: index === 0 ? 'Identifiant Avec Espaces' : entry.id
    }));
    expect(cvSchema.safeParse(withSection('experiences', experiences)).success).toBe(false);
  });

  it("exige les sections sans lesquelles il n'y a pas de CV", () => {
    for (const section of ['identite', 'contact', 'profil', 'experiences', 'formation'] as const) {
      expect(cvSchema.safeParse(sans(base(), section)).success).toBe(false);
    }
  });

  it('laisse optionnelles les sections absentes du fichier de référence', () => {
    for (const section of ['meta', 'references', 'certificats_travail', 'lettre_motivation'] as const) {
      expect(cvSchema.safeParse(sans(base(), section)).success).toBe(true);
    }
  });

  it('accepte `entreprise: null` et `permis: null`, comme le fichier de référence', () => {
    const parsed = cvSchema.parse(base());
    expect(parsed.experiences.find((entry) => entry.id === 'conge-parental')?.entreprise).toBeNull();
    expect(parsed.identite.permis).toBeNull();
  });

  it('donne `dans_cv: true` par défaut : une formation ne disparaît pas par omission', () => {
    const formation = (base().formation as Record<string, unknown>[]).map((entry) =>
      sans(entry, 'dans_cv')
    );
    const parsed = cvSchema.parse(withSection('formation', formation));
    expect(parsed.formation.every((entry) => entry.dans_cv)).toBe(true);
  });
});

describe('cvSchema — les identifiants citables', () => {
  it.each(['experiences', 'formation', 'competences', 'certificats_travail'] as const)(
    'exige un identifiant sur chaque entrée de %s',
    (section) => {
      const entries = (base()[section] as Record<string, unknown>[]).map((entry) =>
        sans(entry, 'id')
      );
      expect(cvSchema.safeParse(withSection(section, entries)).success).toBe(false);
    }
  );

  it.each(['experiences', 'formation', 'competences', 'certificats_travail'] as const)(
    'refuse deux fois le même identifiant dans %s',
    (section) => {
      // Deux `cv:experiences.<id>` identiques désigneraient deux nœuds : une citation de
      // l'agent ne voudrait plus rien dire (AD-4).
      const entries = base()[section] as Record<string, unknown>[];
      const doubled = entries.map((entry) => ({...entry, id: entries[0]!.id}));
      const result = cvSchema.safeParse(withSection(section, doubled));
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('déjà utilisé');
    }
  );
});

describe('cvSchema — la date de naissance, seule date calculée', () => {
  const withBirthDate = (value: unknown) =>
    cvSchema.safeParse(
      withSection('identite', {...(base().identite as object), date_naissance: value})
    );

  it('accepte une date ISO valide', () => {
    expect(withBirthDate('1988-04-12').success).toBe(true);
  });

  it.each(['hier', '12/04/1988', '1988-04', '1988'])('refuse « %s »', (value) => {
    expect(withBirthDate(value).success).toBe(false);
  });

  it('refuse une date hors calendrier plutôt que de calculer un âge faux', () => {
    expect(withBirthDate('1988-14-02').success).toBe(false);
    expect(withBirthDate('1988-02-30').success).toBe(false);
  });

  it('reconnaît une année bissextile', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2023-02-29')).toBe(false);
  });
});

describe('cvSchema — ce qui devient un lien dans la page', () => {
  const withContact = (patch: Record<string, unknown>) =>
    cvSchema.safeParse(withSection('contact', {...(base().contact as object), ...patch}));

  it('accepte une adresse de profil avec ou sans schéma', () => {
    expect(withContact({linkedin: 'linkedin.com/in/quelquun'}).success).toBe(true);
    expect(withContact({linkedin: 'https://linkedin.com/in/quelquun'}).success).toBe(true);
  });

  it("refuse un schéma exécutable : la page en ferait un lien cliquable", () => {
    expect(withContact({linkedin: 'javascript:alert(1)'}).success).toBe(false);
    expect(withContact({linkedin: 'data:text/html,<script>'}).success).toBe(false);
  });

  it("refuse une adresse de courriel qui n'en est pas une", () => {
    expect(withContact({email: 'pas-une-adresse'}).success).toBe(false);
    expect(withContact({email: 'quelquun@exemple.invalid'}).success).toBe(true);
  });
});
