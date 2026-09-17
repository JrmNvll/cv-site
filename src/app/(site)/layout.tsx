/**
 * Racine du **site** — le groupe de routes `(site)`.
 *
 * Elle porte `<html>` et `<body>` pour tout ce que le site sert : les pages
 * sous `[locale]` et sa page 404. L'admin (`/admin`, AD-10) a sa propre
 * racine dans le groupe `(admin)` : il ne se journalise pas et ne porte pas
 * next-intl, deux choses que cette racine fait — d'où deux racines plutôt
 * qu'un signal à effacer partout ailleurs. Deux racines, c'est aussi un
 * chargement complet entre le site et l'admin, ce qui est sans importance.
 *
 * Elle journalise la visite (AD-14) : c'est elle qui voit chaque document du
 * site — et `src/app/global-not-found.tsx`, la 404 de toute URL sans route,
 * fait le même geste. Les cookies que `proxy.ts` vient de poser sont déjà
 * visibles à `cookies()` dans la même requête — une première visite est donc
 * enregistrée avec les identifiants que le navigateur reçoit, et
 * `tests/e2e/journal.spec.ts` le prouve. Lire la requête rend le document
 * dynamique, ce qu'il est déjà : le contenu est lu au démarrage, pas au build
 * (AD-2).
 *
 * Les métadonnées par défaut posent déjà `noindex` (AD-11) : une page qui
 * oublierait de le faire reste couverte.
 */
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {cookies, headers} from 'next/headers';
import {getLocale} from 'next-intl/server';
import {recordVisit} from '@/app/_lib/visit';
import '@/app/globals.css';

export const metadata: Metadata = {
  robots: {index: false, follow: false}
};

export default async function RootLayout({children}: {children: ReactNode}) {
  const locale = await getLocale();
  const [cookieJar, requestHeaders] = await Promise.all([cookies(), headers()]);
  await recordVisit({cookies: cookieJar, headers: requestHeaders, lang: locale});

  return (
    <html lang={locale}>
      {/* Toutes les couleurs viennent des jetons de `globals.css`, qui portent
          seuls la bascule clair/sombre : aucun `dark:` ici ni ailleurs. */}
      <body className="min-h-screen bg-surface font-sans text-[16px] leading-[1.6] text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
