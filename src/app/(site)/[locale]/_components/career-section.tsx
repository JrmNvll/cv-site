/**
 * Le parcours — sous le premier écran, après le positionnement (`CAP-1`).
 *
 * Trois colonnes sur écran large, comme la maquette : la période, le poste et
 * ce qui a été livré, l'environnement technique. Sur écran étroit, une seule
 * colonne, dans le même ordre de lecture.
 *
 * Presque tout y est optionnel dans `cv.yaml` — `entreprise` vaut `null` sur
 * une interruption d'activité, `activite`, `lieu`, `environnement` et
 * `realisations` peuvent manquer. Chaque bloc est donc rendu **ou absent**,
 * jamais rendu vide : `joinParts` retire les séparateurs avec leur valeur.
 */
import {getLocale, getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {joinParts, monthYearLabel, periodLabel} from './format';

export type CareerSectionProps = {
  readonly experiences: DisplayProjection['experiences'];
};

export async function CareerSection({experiences}: CareerSectionProps) {
  const t = await getTranslations();
  const locale = await getLocale();
  if (experiences.length === 0) return null;

  return (
    <section aria-labelledby="parcours" className="pb-14">
      <h2
        id="parcours"
        className="border-b border-rule pb-4 text-[13px] font-semibold tracking-[0.1em] text-ink-muted uppercase"
      >
        {t('sections.career')}
      </h2>

      <ol className="flex flex-col">
        {experiences.map((experience) => {
          const periode = periodLabel(experience.debut, experience.fin, t('career.present'));
          const lieu = joinParts([experience.entreprise, experience.lieu]);

          return (
            <li
              key={experience.id}
              className="grid gap-x-8 gap-y-3 border-b border-rule-soft py-6 last:border-b-0 lg:grid-cols-12"
            >
              {/* Colonnes explicites : une période absente ne doit pas faire
                  remonter le poste dans la première colonne. */}
              {periode === undefined ? null : (
                <p className="text-[14px] text-ink-muted lg:col-span-2 lg:col-start-1 lg:pt-1">
                  {periode}
                </p>
              )}

              <div className="lg:col-span-6 lg:col-start-3">
                <h3 className="text-[19px] leading-snug font-semibold">{experience.poste}</h3>
                {lieu === undefined ? null : (
                  <p className="mt-0.5 text-[15px] text-ink-soft">{lieu}</p>
                )}
                {experience.activite === undefined ? null : (
                  <p className="mt-2.5 max-w-[34em] text-[15px] text-ink-soft">
                    {experience.activite}
                  </p>
                )}
                {experience.realisations === undefined ||
                experience.realisations.length === 0 ? null : (
                  <ul className="mt-2.5 flex max-w-[34em] list-disc flex-col gap-1 pl-5 text-[15px] text-ink-soft marker:text-rule-strong">
                    {/* Le rang dans la clé : deux réalisations au même libellé
                        sont possibles dans un contenu écrit à la main. */}
                    {experience.realisations.map((realisation, rang) => (
                      <li key={`${rang}-${realisation}`}>{realisation}</li>
                    ))}
                  </ul>
                )}
                {/* Le certificat de travail existe ; il ne se télécharge pas ici
                    (il porte un signataire) — il se demande. Décision du
                    2026-09-15. */}
                {experience.certificat === undefined ? null : (
                  <p className="mt-2.5 text-[13px] text-ink-muted">
                    {t('career.certificate', {
                      date: monthYearLabel(experience.certificat.date, locale) ?? ''
                    })}
                  </p>
                )}
              </div>

              {experience.environnement === undefined ||
              experience.environnement.length === 0 ? null : (
                <ul
                  aria-label={t('career.environment')}
                  className="flex flex-wrap content-start gap-1.5 lg:col-span-4 lg:col-start-9 lg:pt-1"
                >
                  {experience.environnement.map((outil, rang) => (
                    <li
                      key={`${rang}-${outil}`}
                      className="rounded-[3px] bg-tag px-2.5 py-1 text-[12.5px] text-ink-soft"
                    >
                      {outil}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
