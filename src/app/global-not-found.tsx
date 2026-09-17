/**
 * La 404 **globale** — toute URL qui ne correspond à aucune route : un chemin
 * inconnu sous une langue (`/fr/chemin-inexistant`), une sonde à plusieurs
 * segments (`/api/inconnu`). Une sonde à **un** segment (`/wp-login.php`,
 * `/.env`) est attrapée par `[locale]`, dont le layout lève `notFound()` :
 * statut 404 et `noindex` sont là, mais le corps est rendu par le navigateur
 * — comme avant cette story, et rien ne l'empêche (`dynamicParams = false`
 * passe par le même `notFound()`).
 *
 * Pourquoi ce fichier, et pas un catch-all qui lèverait `notFound()` : avec
 * deux racines (`(site)`, `(admin)`), il n'y a plus de layout au sommet de
 * `src/app` pour composer la route `/_not-found` de Next ; et un `notFound()`
 * levé dans un rendu dynamique fait échouer la coquille du document — Next
 * ne sert alors qu'une page vide que le navigateur remplit lui-même, rien
 * sans JavaScript. Ici, Next sert cette page **directement**, au niveau du
 * routage, comme un document complet : c'est le seul chemin qui rende une
 * 404 lisible sans JavaScript, comme le site le faisait avant la story 8.
 *
 * C'est la 404 du **site** : son document (langue de la requête, jetons de
 * `globals.css`), son texte (`notFound` du catalogue), et sa journalisation —
 * une page inconnue est une visite comme une autre (AD-14) quand le proxy a
 * posé les cookies ; une sonde que le proxy ne voit pas n'en porte aucun, et
 * rien n'est écrit. L'admin garde sa propre 404 pour ce qu'il reconnaît
 * (`/admin/sessions/<inconnu>`, `/admin/inconnu`).
 */
import type {Metadata} from 'next';
import {cookies, headers} from 'next/headers';
import {getLocale, getTranslations} from 'next-intl/server';
import SiteNotFound from './(site)/not-found';
import {recordVisit} from './_lib/visit';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {title: t('title'), robots: {index: false, follow: false}};
}

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const [cookieJar, requestHeaders] = await Promise.all([cookies(), headers()]);
  await recordVisit({cookies: cookieJar, headers: requestHeaders, lang: locale});

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-surface font-sans text-[16px] leading-[1.6] text-ink antialiased">
        <SiteNotFound />
      </body>
    </html>
  );
}
