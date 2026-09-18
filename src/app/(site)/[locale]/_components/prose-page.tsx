/**
 * La fabrique des deux pages de prose (story 9) : « Comment ce site est
 * construit » et « Mentions légales & confidentialité » ne diffèrent que par
 * leurs textes, leur espace de messages et ce qui suit le corps — le bouton du
 * courriel pour les mentions. Tout le reste est ici, une fois : la langue
 * vérifiée, les métadonnées (titre, description, `noindex` — AD-11), la
 * coquille commune (`PageFrame`), l'article.
 *
 * C'est aussi ici, et non dans chaque page, que la projection d'affichage
 * est lue — par un import **différé** de `@/content`, comme dans `page.tsx` :
 * `@/content` entraîne `@/env`, dont le parsage a lieu au chargement du
 * module, et le build ne doit réclamer aucune variable. Elle sert au nom de
 * la barre et au `{name}` des textes (`prose-template.ts`) : le dépôt public
 * ne porte aucun nom, c'est le contenu qui nomme. `tests/unit/
 * page-projection.test.ts` tient la liste de ce qui atteint `@/content`.
 *
 * Une page qui en sort exporte `generateMetadata` et `Page` — rien d'autre :
 * Next refuse tout autre export d'un fichier de page.
 */
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {hasLocale} from 'next-intl';
import {getTranslations, setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing, type Locale} from '@/i18n/routing';
import {joinParts} from './format';
import {PageFrame} from './page-frame';
import {ProseArticle} from './prose-article';
import {fillTemplate} from './prose-template';

type LocaleParams = {locale: string};
type Translator = Awaited<ReturnType<typeof getTranslations>>;

export type ProsePageOptions = {
  /** L'espace des messages de la page : `title` et `description` y vivent. */
  readonly namespace: 'pages.comment' | 'pages.mentions';
  /** Le corps, par langue — le fichier Markdown de chacune. */
  readonly body: Readonly<Record<Locale, string>>;
  /** L'hébergeur, pour `{hebergeur}` ; vide, la phrase se passe du nom. */
  readonly hostingProvider?: string;
  /** Ce qui suit le corps, sous sa dernière rubrique. */
  readonly after?: (t: Translator) => ReactNode;
};

export function prosePage({namespace, body, hostingProvider = '', after}: ProsePageOptions) {
  async function generateMetadata({params}: {params: Promise<LocaleParams>}): Promise<Metadata> {
    const {locale} = await params;
    const t = await getTranslations({
      locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
      namespace
    });
    return {
      title: t('title'),
      description: t('description'),
      robots: {index: false, follow: false}
    };
  }

  async function Page({params}: {params: Promise<LocaleParams>}) {
    const {locale} = await params;
    if (!hasLocale(routing.locales, locale)) {
      notFound();
    }
    setRequestLocale(locale);
    const t = await getTranslations();

    const {displayProjection} = await import('@/content');
    const {identite} = displayProjection(locale);
    const name = joinParts([identite.prenom, identite.nom], ' ') ?? '';

    return (
      <PageFrame locale={locale} identite={identite}>
        <ProseArticle title={t(`${namespace}.title`)} body={fillTemplate(body[locale], {name, hebergeur: hostingProvider})}>
          {after?.(t)}
        </ProseArticle>
      </PageFrame>
    );
  }

  return {generateMetadata, Page};
}
