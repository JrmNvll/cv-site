/**
 * La coquille commune aux pages du site : le conteneur, la barre, `main`, le
 * pied de page — la page CV et les deux pages de prose (story 9) la
 * partagent, pour que barre et pied de page soient les mêmes partout.
 *
 * Elle ne lit rien : l'identité de la barre lui est passée par la page —
 * `page.tsx` pour le CV, la fabrique `prose-page.tsx` pour les deux autres —
 * qui sont les seules à atteindre `@/content`, par un import différé
 * (`tests/unit/page-projection.test.ts` en tient la liste).
 *
 * `className` s'ajoute au conteneur — la page CV y réserve, sous `lg`, la
 * hauteur de la barre fixe de l'assistant ; `after` vient après le pied de
 * page, pour ce qui n'est pas dans le flux du document (cette même barre).
 */
import type {ReactNode} from 'react';
import type {Locale} from '@/i18n/routing';
import {joinParts} from './format';
import {SiteFooter} from './site-footer';
import {SiteHeader, type SiteHeaderProps} from './site-header';

export type PageFrameProps = {
  readonly locale: Locale;
  readonly identite: SiteHeaderProps['identite'];
  /** Hors de la page principale : le nom de la barre y ramène. */
  readonly homeHref?: SiteHeaderProps['homeHref'];
  readonly className?: string;
  readonly children: ReactNode;
  readonly after?: ReactNode;
};

export function PageFrame({locale, identite, homeHref, className, children, after}: PageFrameProps) {
  return (
    <div className={joinParts(['mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-[72px]', className], ' ')}>
      <SiteHeader identite={identite} locale={locale} homeHref={homeHref} />
      <main>{children}</main>
      <SiteFooter locale={locale} />
      {after}
    </div>
  );
}
