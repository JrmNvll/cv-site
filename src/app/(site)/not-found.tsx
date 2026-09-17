/**
 * Le corps de la 404 du site, deux fois servi :
 *  - par `src/app/global-not-found.tsx`, pour toute URL sans route — c'est
 *    le cas ordinaire, un document complet, journalisé ;
 *  - par la frontière `not-found` du groupe `(site)`, pour un `notFound()`
 *    levé sous cette racine — une langue inconnue à un seul segment
 *    (`/wp-login.php`) : Next ne sert alors qu'une coquille que le navigateur
 *    remplit, statut et `noindex` compris, comme avant cette story.
 * L'admin a sa propre 404, en français, dans `src/app/(admin)/admin/`.
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
