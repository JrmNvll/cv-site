/**
 * Les références — en fin de page, après la formation.
 *
 * Ce que la page dit d'un tiers s'arrête au nom et à la fonction : ce que le
 * corpus dit déjà (`ref-01`). Ses coordonnées ne sont **jamais** dans le HTML
 * servi ; comme le numéro de Jérémie, elles s'obtiennent par une route sur un
 * geste explicite (`/api/references/<id>/contact`), avec l'accord de la
 * personne — décision de Jérémie du 2026-09-15, en amendement d'AD-8.
 *
 * La projection n'annonce que la **présence** de coordonnées (`contact`) : le
 * bouton n'est proposé que s'il y a quelque chose à révéler.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {ContactReveal} from './contact-reveal';

export type ReferencesSectionProps = {
  readonly references: DisplayProjection['references'];
};

export async function ReferencesSection({references}: ReferencesSectionProps) {
  const t = await getTranslations();
  if (references.length === 0) return null;

  return (
    <section aria-labelledby="references" className="pb-14">
      <h2
        id="references"
        className="border-b border-rule pb-4 text-[13px] font-semibold tracking-[0.1em] text-ink-muted uppercase"
      >
        {t('sections.references')}
      </h2>

      <ul className="flex flex-col gap-5 pt-6">
        {references.map((reference) => (
          <li key={reference.id} className="text-[15px]">
            <p className="font-semibold text-ink">{reference.nom}</p>
            {reference.fonction === undefined ? null : (
              <p className="text-ink-soft">{reference.fonction}</p>
            )}
            {reference.contact ? (
              // `empty:hidden` : sans JavaScript, le composant ne rend rien —
              // pas de ligne vide sous la fonction.
              <p className="mt-1 empty:hidden">
                <ContactReveal
                  endpoint={`/api/references/${reference.id}/contact`}
                  labels={{
                    reveal: t('references.reveal'),
                    pending: t('references.pending'),
                    label: t('references.label'),
                    unavailable: t('references.unavailable')
                  }}
                />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
