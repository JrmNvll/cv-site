/**
 * Le pied de page : deux liens, discrets, sur chaque page du site (story 9).
 *
 * « Comment ce site est construit » et « Mentions légales & confidentialité »
 * — les deux pages que la maquette annonçait et que la story 3 avait dû
 * reporter, faute de cible. Retiré alors, le pied de page revient ici, avec
 * ces deux liens et rien d'autre : ni formulaire, ni compteur. Un `<nav>`
 * nommé : un lecteur d'écran le liste parmi les repères de la page.
 *
 * Des ancres ordinaires, pas des `Link` : une navigation côté client ne
 * rejouerait pas la racine du site, et la visite ne serait pas journalisée
 * (AD-14, report de la story 4). Deux clics par visite, au plus — la
 * navigation complète ne coûte rien, et le proxy reconduit les cookies.
 */
import {getTranslations} from 'next-intl/server';
import type {Locale} from '@/i18n/routing';

export type SiteFooterProps = {
  readonly locale: Locale;
};

const LINK =
  'underline-offset-4 hover:text-ink hover:underline focus-visible:text-ink focus-visible:underline focus-visible:outline-none';

export async function SiteFooter({locale}: SiteFooterProps) {
  const t = await getTranslations('footer');

  return (
    <footer className="border-t border-rule py-6 text-[13px] text-ink-muted">
      <nav aria-label={t('label')} className="flex flex-wrap gap-x-8 gap-y-2">
        <a href={`/${locale}/comment`} className={LINK}>
          {t('comment')}
        </a>
        <a href={`/${locale}/mentions`} className={LINK}>
          {t('mentions')}
        </a>
      </nav>
    </footer>
  );
}
