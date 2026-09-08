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
      <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
      <p className="text-neutral-700 dark:text-neutral-300">{t('body')}</p>
    </main>
  );
}
