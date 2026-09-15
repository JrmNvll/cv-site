/**
 * Page 404 de dernier recours — elle couvre ce qui n'appartient à aucune langue
 * (`/admin` non servi, chemin inconnu) et ce que `notFound()` déclenche depuis
 * `[locale]`. Le document HTML vient de la racine `src/app/layout.tsx`.
 */
import {getTranslations} from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-tight font-normal">
        {t('heading')}
      </h1>
      <p className="text-ink-soft">{t('body')}</p>
    </main>
  );
}
