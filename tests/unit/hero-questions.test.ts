/**
 * La correspondance libellé → entrée du premier écran (`hero-questions.ts`)
 * « ne se devine pas » (`content-contract.md`) : elle n'est adossée à rien
 * d'autre qu'à ce test. Deux choses à prouver :
 *
 *  - les rangées d'affichage sont exactement les questions, ni doublon ni oubli
 *    — une puce absente ou répétée ne se verrait qu'à l'œil ;
 *  - chaque identifiant désigne une entrée **ordinaire** du corpus : ni PRIVÉ,
 *    ni PASSE, ni vide. La story 5 restituera ces réponses sans appeler le
 *    modèle ; une entrée muette y ferait une puce qui ne répond rien.
 */
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {HERO_QUESTIONS, HERO_ROWS, MATCH_QUESTION} from '@/app/[locale]/_components/hero-questions';
import {loadContent} from '@/content/load';
import {LANGS} from '@/content/schema';

const FIXTURES = fileURLToPath(new URL('../fixtures/content', import.meta.url));

describe('les six questions du premier écran', () => {
  it('affiche chaque question une fois, et rien dʼautre', () => {
    const affichees = HERO_ROWS.flat();
    expect([...affichees].sort()).toEqual([...HERO_QUESTIONS].sort());
    expect(new Set(affichees).size).toBe(HERO_QUESTIONS.length);
    expect(HERO_QUESTIONS).not.toContain(MATCH_QUESTION);
  });

  it.each(LANGS)('désigne des entrées ordinaires du corpus (%s)', (lang) => {
    const {content} = loadContent(FIXTURES);
    for (const id of HERO_QUESTIONS) {
      const entree = content.byId[lang][id];
      expect(entree, `${id} doit exister dans qa.${lang}.md`).toBeDefined();
      expect(entree!.statut, `${id} doit être une entrée ordinaire`).toBe('normale');
    }
  });
});
