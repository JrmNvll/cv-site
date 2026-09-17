/**
 * Racine de l'**admin** — le groupe de routes `(admin)`, sous `/admin` (AD-10).
 *
 * Une seconde racine, distincte de celle du site (`src/app/(site)/layout.tsx`),
 * parce que l'admin ne fait pas ce que le site fait :
 *  - il **ne se journalise pas** — aucune écriture de visite, aucune lecture
 *    d'un cookie de visite, et `proxy.ts` n'en pose aucun sur `/admin*` ; une
 *    visite de Jérémie n'est pas une visite du CV ;
 *  - il est **en français seulement**, hors du routage next-intl : `lang="fr"`
 *    en dur, ses textes dans ses composants, rien dans `messages/`.
 *
 * Tout le reste est commun : le document, `globals.css` et ses jetons (aucune
 * couleur écrite ici, la bascule clair/sombre reste dans la feuille), le
 * `noindex` d'AD-11. Ce que l'admin montre est à Jérémie : Caddy protège en
 * production, `ADMIN_DEV=1` ouvre en développement — aucune authentification
 * dans l'application. Une page qui lève (journal indisponible) tombe sur
 * `error.tsx`, en français, dans ce document.
 *
 * Tout est rendu côté serveur et lisible **sans JavaScript** : des liens et
 * des formulaires HTML. `Link` ne fait que rendre une ancre — sans
 * préchargement, pour qu'aucune page ne soit lue avant qu'on la demande.
 */
import Link from 'next/link';
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import '@/app/globals.css';
import {AdminNav} from './_components/admin-nav';

/** Chaque page exporte son titre ; le gabarit y ajoute le nom de l'espace. */
export const metadata: Metadata = {
  title: {default: 'Administration', template: '%s — Administration'},
  robots: {index: false, follow: false}
};

export default function AdminLayout({children}: {children: ReactNode}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-surface font-sans text-[16px] leading-[1.6] text-ink antialiased">
        <div className="mx-auto w-full max-w-[1280px] px-5 pb-16 sm:px-8">
          <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-rule py-5">
            <p className="font-serif text-[21px] tracking-[0.01em]">
              <Link prefetch={false} href="/admin">Administration</Link>
              <span className="ml-3 text-[13px] font-sans uppercase tracking-[0.08em] text-ink-muted">journal des visites</span>
            </p>
            <AdminNav />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
