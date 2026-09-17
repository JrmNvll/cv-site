/**
 * Les libellés des six puces, calculés comme la page les calcule — par les
 * mêmes messages, la même règle de pluriel ICU (`intl-messageformat`, ce que
 * next-intl utilise) et le même repli quand les années ne se calculent pas.
 * Rien n'est recopié : un libellé changé dans `messages/*.json` change ici.
 */
import IntlMessageFormat from 'intl-messageformat';
import {careerYears} from '../../src/app/(site)/[locale]/_components/format';
import {
  HERO_QUESTIONS,
  MATCH_QUESTION,
  YEARS_QUESTION
} from '../../src/app/(site)/[locale]/_components/hero-questions';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {display, type Lang} from './fixture-cv';

const messages = {fr, en};

export function heroLabel(locale: Lang, id: string): string {
  const questions: Record<string, string> = messages[locale].assistant.questions;
  const label = questions[id];
  if (label === undefined) throw new Error(`aucun libellé pour ${id} en ${locale}`);
  if (id !== YEARS_QUESTION) return label;
  const years = careerYears(display[locale].experiences, new Date());
  if (years === undefined) return messages[locale].assistant.yearsUnknown;
  return String(new IntlMessageFormat(label, locale).format({years}));
}

export function heroLabels(locale: Lang): string[] {
  return [...HERO_QUESTIONS, MATCH_QUESTION].map((id) => heroLabel(locale, id));
}

/** Le mot-sentinelle du corps d'une entrée de la fixture : sans caractère échappable. */
export function sentinelle(locale: Lang, id: string): string {
  return `${locale === 'fr' ? 'Sentinelle-corps' : 'Sentinel-body'}-${id.replace('-', '')}`;
}
