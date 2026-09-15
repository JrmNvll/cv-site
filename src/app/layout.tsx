/**
 * Racine unique de l'application.
 *
 * Elle porte `<html>` et `<body>` pour **tout** ce que sert Next : les pages
 * sous `[locale]`, la page 404, et `/admin` qui vit hors du routage de langue
 * (AD-10). Sans elle, ces deux dernières seraient rendues sans document HTML.
 *
 * Les métadonnées par défaut posent déjà `noindex` (AD-11) : une page qui
 * oublierait de le faire reste couverte.
 */
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {getLocale} from 'next-intl/server';
import './globals.css';

export const metadata: Metadata = {
  robots: {index: false, follow: false}
};

export default async function RootLayout({children}: {children: ReactNode}) {
  const locale = await getLocale();

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
