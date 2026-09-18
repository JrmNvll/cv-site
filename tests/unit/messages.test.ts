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
import {HERO_QUESTIONS, MATCH_QUESTION} from '@/app/(site)/[locale]/_components/hero-questions';
import {CHAT_REFUSAL_REASONS} from '@/app/_lib/chat-contract';
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
          'contact.linkedin',
          'contact.github',
          'sections.contact',
          'phone.reveal',
          'phone.pending',
          'phone.label',
          'phone.unavailable',
          'email.reveal',
          'email.pending',
          'email.label',
          'email.unavailable',
          'identity.photoAlt',
          'identity.years',
          'identity.companies',
          'assistant.eyebrow',
          'assistant.intro',
          'assistant.placeholder',
          'assistant.loading',
          'assistant.answerSource',
          'assistant.back',
          'errors.unavailable',
          'errors.invalid_input',
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
          'assistant.yearsUnknown',
          'assistant.withoutScript',
          'errors.content_unavailable',
          'education.proof',
          'career.certificate',
          'sections.references',
          'references.reveal',
          'references.pending',
          'references.label',
          'references.unavailable',
          'notFound.heading',
          // Le champ libre (story 6) : ses libellés, la mention sous une
          // réponse du modèle, et chaque raison de refus d'AD-16.
          'assistant.send',
          'assistant.questionLabel',
          'assistant.answerModel',
          'assistant.answerSources',
          'errors.no_visitor',
          'errors.rate_limited',
          'errors.cap_reached',
          'errors.model_unavailable',
          // L'annonce (story 7) : le titre de la réponse, le nom court de la
          // zone, son invite, son compte, ses boutons.
          'assistant.matchTitle',
          'assistant.matchLabel',
          'assistant.matchIntro',
          'assistant.matchPlaceholder',
          'assistant.matchSend',
          'assistant.matchCount',
          'assistant.matchBack',
          // Les deux pages de prose et le pied de page (story 9) : le lien, le
          // titre et la description de chacune.
          'footer.label',
          'footer.comment',
          'footer.mentions',
          'pages.comment.title',
          'pages.comment.description',
          'pages.mentions.title',
          'pages.mentions.description'
        ])
      );
      // Tout répond une fois hydraté : la ligne d'état « pas encore » n'a plus d'objet.
      expect(keys).not.toContain('assistant.inactive');
    }
  });

  /**
   * Le lien du pied de page et le titre de la page qu'il ouvre disent la même
   * chose ; et la règle 6 du prompt nomme la page des mentions par ce titre
   * (AD-4) : `tests/unit/context.test.ts` vérifie le prompt, ceci le catalogue.
   */
  it('nomme les pages de prose du même nom dans le pied de page et dans leur titre', () => {
    for (const locale of Object.keys(catalogs)) {
      for (const page of ['comment', 'mentions']) {
        expect(valueAt(catalogs[locale]!, `footer.${page}`)).toBe(valueAt(catalogs[locale]!, `pages.${page}.title`));
      }
    }
    expect(valueAt(catalogs.fr!, 'pages.mentions.title')).toBe('Mentions légales & confidentialité');
    expect(valueAt(catalogs.en!, 'pages.mentions.title')).toBe('Legal notice & privacy');
  });

  it('compte les caractères de lʼannonce par deux paramètres ICU, sans chiffre écrit', () => {
    for (const locale of Object.keys(catalogs)) {
      const libelle = String(valueAt(catalogs[locale]!, 'assistant.matchCount'));
      expect(libelle).toContain('{count}');
      expect(libelle).toContain('{max}');
      expect(libelle).not.toMatch(/\d/);
    }
  });

  it('prévient que le texte collé est conservé, et la ligne sans JavaScript compte six puces', () => {
    expect(String(valueAt(catalogs.fr!, 'assistant.matchIntro'))).toMatch(/conservé/);
    expect(String(valueAt(catalogs.en!, 'assistant.matchIntro'))).toMatch(/is kept/);
    expect(String(valueAt(catalogs.fr!, 'assistant.withoutScript'))).toMatch(/six puces/);
    expect(String(valueAt(catalogs.en!, 'assistant.withoutScript'))).toMatch(/six chips/);
    // Un nom court pour la zone : pas la phrase entière de l'invite.
    for (const locale of Object.keys(catalogs)) {
      const label = String(valueAt(catalogs[locale]!, 'assistant.matchLabel'));
      const intro = String(valueAt(catalogs[locale]!, 'assistant.matchIntro'));
      expect(label.length).toBeLessThan(40);
      expect(intro.length).toBeGreaterThan(label.length);
    }
  });

  /**
   * Chaque `reason` d'AD-16 a sa clé `errors.<reason>` : un refus sans
   * message afficherait un chemin de clé. La liste vient du contrat de la
   * route, pas d'une copie.
   */
  it('porte un message pour chaque raison de refus de /api/chat', () => {
    for (const locale of Object.keys(catalogs)) {
      const keys = flatten(catalogs[locale]!);
      for (const reason of CHAT_REFUSAL_REASONS) {
        expect(keys).toContain(`errors.${reason}`);
      }
    }
  });

  it('compte les sources au pluriel ICU, sans chiffre écrit', () => {
    for (const locale of Object.keys(catalogs)) {
      const libelle = String(valueAt(catalogs[locale]!, 'assistant.answerSources'));
      expect(libelle).toMatch(/\{count, plural,/);
      expect(libelle).not.toMatch(/\d/);
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

  /**
   * « Que reste-t-il de ses 20 ans ? » : le chiffre est le résultat de
   * `careerYears` sur le contenu réel, pas une valeur à recopier — sinon il
   * faudrait penser à l'incrémenter chaque année (report de la story 3).
   */
  it('ne recopie aucun nombre dʼannées dans le libellé de wd-02 : il est paramétré', () => {
    for (const locale of Object.keys(catalogs)) {
      const libelle = String(valueAt(catalogs[locale]!, 'assistant.questions.wd-02'));
      // Un pluriel ICU sur `years` : « 1 an », « 20 ans » — et aucun chiffre écrit.
      expect(libelle).toMatch(/\{years, plural,/);
      expect(libelle).not.toMatch(/\d/);
    }
  });
});
