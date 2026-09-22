/**
 * La barre : le nom à gauche, la langue à droite.
 *
 * Décisions de Jérémie du 2026-09-17 : le nom reste dans la barre, à la taille
 * du titre du premier écran (`HEADLINE`, source unique) ; le choix de la langue
 * passe à droite ; les coordonnées rejoignent la section « Contact »
 * (`SkillsSection`), avec GitHub.
 *
 * Décision de Jérémie du 2026-09-22 : hors de la page principale, le nom
 * ramène à la page principale — un lien qui ne se voit pas (même police,
 * même couleur, aucun soulignement, seul le clavier révèle le focus). Sur la
 * page principale elle-même, le nom reste un texte : un lien vers soi ne
 * sert à rien. C'est la page qui le dit, par `homeHref`.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {routing, type Locale} from '@/i18n/routing';
import {joinParts} from './format';
import {HEADLINE} from './identity-heading';
import {LanguageSwitch} from './language-switch';

export type SiteHeaderProps = {
  readonly identite: Pick<DisplayProjection['identite'], 'prenom' | 'nom'>;
  readonly locale: Locale;
  /** Posé hors de la page principale : le nom devient un lien vers elle. */
  readonly homeHref?: string;
};

/** Le lien invisible : rien ne le distingue du texte, sauf le focus clavier. */
const HOME_LINK = 'text-inherit no-underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current';

export async function SiteHeader({identite, locale, homeHref}: SiteHeaderProps) {
  const t = await getTranslations();
  const names = Object.fromEntries(
    routing.locales.map((target) => [target, t(`languages.${target}`)])
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-rule py-5">
      {homeHref === undefined ? (
        <p className={HEADLINE}>{joinParts([identite.prenom, identite.nom], ' ')}</p>
      ) : (
        <a href={homeHref} className={`${HEADLINE} ${HOME_LINK}`}>
          {joinParts([identite.prenom, identite.nom], ' ')}
        </a>
      )}
      <div className="text-[14px]">
        <LanguageSwitch
          current={locale}
          locales={routing.locales}
          label={t('languages.label')}
          names={names}
        />
      </div>
    </header>
  );
}
