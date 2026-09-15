/**
 * Racine unique de l'application.
 *
 * Elle porte `<html>` et `<body>` pour **tout** ce que sert Next : les pages
 * sous `[locale]`, la page 404, et `/admin` qui vit hors du routage de langue
 * (AD-10). Sans elle, ces deux dernières seraient rendues sans document HTML.
 *
 * C'est aussi pour cela qu'elle journalise la visite (AD-14) : c'est le seul
 * endroit qui voit chaque document, 404 comprise. Les cookies que `proxy.ts`
 * vient de poser sont déjà visibles à `cookies()` dans la même requête — une
 * première visite est donc enregistrée avec les identifiants que le navigateur
 * reçoit, et `tests/e2e/journal.spec.ts` le prouve. Lire la requête rend le
 * document dynamique, ce qu'il est déjà : le contenu est lu au démarrage, pas
 * au build (AD-2).
 *
 * Les métadonnées par défaut posent déjà `noindex` (AD-11) : une page qui
 * oublierait de le faire reste couverte.
 */
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {cookies, headers} from 'next/headers';
import {getLocale} from 'next-intl/server';
import {recordVisit} from './_lib/visit';
import './globals.css';

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
