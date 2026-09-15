/**
 * La barre : le nom, la langue, les coordonnées publiées.
 *
 * Coordonnées publiées = courriel et LinkedIn, et rien d'autre (contrainte du
 * SPEC). Le téléphone n'est pas ici : il est demandé par `PhoneReveal`, qui ne
 * rend rien tant que le visiteur n'a pas cliqué. Aucune adresse postale.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {routing, type Locale} from '@/i18n/routing';
import {joinParts} from './format';
import {LanguageSwitch} from './language-switch';
import {PhoneReveal} from './phone-reveal';

export type SiteHeaderProps = {
  readonly identite: DisplayProjection['identite'];
  readonly contact: DisplayProjection['contact'];
  readonly locale: Locale;
};

export async function SiteHeader({identite, contact, locale}: SiteHeaderProps) {
  const t = await getTranslations();
  const names = Object.fromEntries(
    routing.locales.map((target) => [target, t(`languages.${target}`)])
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-rule py-5">
      <p className="font-serif text-[21px] tracking-[0.01em]">
        {joinParts([identite.prenom, identite.nom], ' ')}
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
        <LanguageSwitch
          current={locale}
          locales={routing.locales}
          label={t('languages.label')}
          names={names}
        />
        <ul aria-label={t('header.contact')} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <li className="min-w-0">
            <a
              href={`mailto:${contact.email}`}
              className="break-all text-accent underline-offset-4 hover:text-accent-strong hover:underline"
            >
              {contact.email}
            </a>
          </li>
          {contact.linkedin === undefined ? null : (
            <li>
              <a
                href={contact.linkedin}
                rel="noopener noreferrer me"
                target="_blank"
                className="text-accent underline-offset-4 hover:text-accent-strong hover:underline"
              >
                {t('header.linkedin')}
              </a>
            </li>
          )}
          {/* `empty:hidden` : sans JavaScript, `PhoneReveal` ne rend rien — et un
              élément de liste vide laisserait deux écarts de grille visibles. */}
          <li className="empty:hidden">
            <PhoneReveal
              labels={{
                reveal: t('phone.reveal'),
                pending: t('phone.pending'),
                label: t('phone.label'),
                unavailable: t('phone.unavailable')
              }}
            />
          </li>
        </ul>
      </div>
    </header>
  );
}
