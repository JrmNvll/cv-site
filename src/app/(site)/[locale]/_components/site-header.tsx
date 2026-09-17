/**
 * La barre : le nom à gauche, la langue à droite.
 *
 * Décisions de Jérémie du 2026-09-17 : le nom reste dans la barre, à la taille
 * du titre du premier écran (`HEADLINE`, source unique) ; le choix de la langue
 * passe à droite ; les coordonnées rejoignent la section « Contact »
 * (`SkillsSection`), avec GitHub.
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
};

export async function SiteHeader({identite, locale}: SiteHeaderProps) {
  const t = await getTranslations();
  const names = Object.fromEntries(
    routing.locales.map((target) => [target, t(`languages.${target}`)])
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-rule py-5">
      <p className={HEADLINE}>{joinParts([identite.prenom, identite.nom], ' ')}</p>
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
