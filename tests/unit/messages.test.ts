/**
 * AD-5 — `/fr` et `/en` servent l'intégralité de l'interface.
 *
 * Une clé manquante dans un catalogue affiche son chemin brut à l'écran
 * (« shell.tagline ») sans rien casser. Ce test compare les deux catalogues
 * clé par clé, dans les deux sens, et refuse une valeur vide.
 */
import {describe, expect, it} from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {HERO_QUESTIONS, MATCH_QUESTION} from '@/app/[locale]/_components/hero-questions';
import {routing} from '@/i18n/routing';

type Catalog = {[key: string]: string | Catalog};

/** Chemins de clés aplatis : `shell.tagline`, `meta.title`… */
function flatten(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

function valueAt(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Catalog)?.[key], catalog);
}

const catalogs: Record<string, Catalog> = {fr: fr as Catalog, en: en as Catalog};

describe('catalogues de messages', () => {
  it('couvre exactement les locales du routage', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...routing.locales].sort());
  });

  it('porte les mêmes chemins de clés en français et en anglais', () => {
    const frenchKeys = flatten(catalogs.fr!).sort();
    const englishKeys = flatten(catalogs.en!).sort();

    expect(englishKeys).toEqual(frenchKeys);
  });

  it.each(Object.keys(catalogs))('nʼa aucune valeur vide en %s', (locale) => {
    const empty = flatten(catalogs[locale]!).filter(
      (path) => String(valueAt(catalogs[locale]!, path)).trim() === ''
    );

    expect(empty).toEqual([]);
  });

  it('porte les clés dont la page a besoin', () => {
    for (const locale of Object.keys(catalogs)) {
      const keys = flatten(catalogs[locale]!);
      expect(keys).toEqual(
        expect.arrayContaining([
          'meta.title',
          'meta.description',
          'languages.label',
          'languages.fr',
          'languages.en',
          'header.contact',
          'header.linkedin',
          'phone.reveal',
          'phone.pending',
          'phone.label',
          'phone.unavailable',
          'identity.photoAlt',
          'identity.years',
          'identity.companies',
          'assistant.eyebrow',
          'assistant.intro',
          'assistant.placeholder',
          'assistant.inactive',
          'sections.career',
          'sections.skills',
          'sections.assets',
          'sections.spokenLanguages',
          'sections.education',
          'sections.practical',
          'career.present',
          'career.environment',
          'practical.age',
          'education.option',
          'education.equivalence',
          'notFound.heading'
        ])
      );
    }
  });

  /**
   * Les six questions du hero sont des **libellés d'interface** attachés à des
   * entrées du corpus, par une correspondance qui ne se devine pas
   * (`content-contract.md`). Un libellé manquant afficherait le chemin de sa
   * clé — « assistant.questions.wd-02 » — sur le premier écran du site.
   */
  it('porte un libellé pour chacune des six questions du hero', () => {
    for (const locale of Object.keys(catalogs)) {
      const keys = flatten(catalogs[locale]!);
      for (const id of [...HERO_QUESTIONS, MATCH_QUESTION]) {
        expect(keys).toContain(`assistant.questions.${id}`);
      }
    }
  });

  it("n'annonce aucune question de plus que les six prévues", () => {
    const attendues = [...HERO_QUESTIONS, MATCH_QUESTION].map((id) => `assistant.questions.${id}`);
    for (const locale of Object.keys(catalogs)) {
      const posees = flatten(catalogs[locale]!).filter((path) =>
        path.startsWith('assistant.questions.')
      );
      expect(posees.sort()).toEqual([...attendues].sort());
    }
  });
});
