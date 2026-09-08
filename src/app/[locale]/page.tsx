/**
 * Page racine de la langue courante. Elle deviendra le CV lui-même : il n'y a
 * pas de page d'accueil distincte. Pour l'instant, coquille de vérification.
 */
import {hasLocale} from 'next-intl';
import {getTranslations, setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {Link} from '@/i18n/navigation';
import {routing, type Locale} from '@/i18n/routing';

export default async function LocaleHomePage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations('shell');
  const tLanguages = await getTranslations('languages');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
      <p className="text-lg text-neutral-700 dark:text-neutral-300">{t('tagline')}</p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('underConstruction')}</p>
      <nav aria-label={tLanguages('label')} className="flex gap-4 text-sm">
        {routing.locales.map((target: Locale) => (
          <Link
            key={target}
            href="/"
            locale={target}
            aria-current={target === locale ? 'page' : undefined}
            className="underline underline-offset-4"
          >
            {tLanguages(target)}
          </Link>
        ))}
      </nav>
    </main>
  );
}
