/**
 * La barre : le nom, la langue, les coordonnées.
 *
 * En clair, LinkedIn — et rien d'autre. Le courriel et le numéro sont demandés
 * par `ContactReveal`, qui ne rend rien tant que le visiteur n'a pas cliqué :
 * ni l'un ni l'autre ne sont dans le HTML servi (AD-8, amendé le 2026-09-15).
 * Sans JavaScript, LinkedIn reste le seul moyen de contact affiché — et
 * l'assistant, lui aussi, sait donner le courriel. Aucune adresse postale.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {routing, type Locale} from '@/i18n/routing';
import {joinParts} from './format';
import {LanguageSwitch} from './language-switch';
import {ContactReveal} from './contact-reveal';

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
        {/* `id="contact"` : l'ancre vers laquelle le panneau renvoie quand
            l'assistant ne peut pas répondre — plafond atteint, modèle
            indisponible (AD-16 : « affichent le contact direct »). */}
        <ul
          id="contact"
          aria-label={t('header.contact')}
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          {/* `empty:hidden` : sans JavaScript, `ContactReveal` ne rend rien — et un
              élément de liste vide laisserait un écart de grille visible. */}
          <li className="empty:hidden">
            <ContactReveal
              endpoint="/api/contact/email"
              labels={{
                reveal: t('email.reveal'),
                pending: t('email.pending'),
                label: t('email.label'),
                unavailable: t('email.unavailable')
              }}
            />
          </li>
          <li className="empty:hidden">
            <ContactReveal
              endpoint="/api/contact/phone"
              labels={{
                reveal: t('phone.reveal'),
                pending: t('phone.pending'),
                label: t('phone.label'),
                unavailable: t('phone.unavailable')
              }}
            />
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
        </ul>
      </div>
    </header>
  );
}
