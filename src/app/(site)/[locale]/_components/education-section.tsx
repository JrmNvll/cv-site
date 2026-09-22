/**
 * La formation — en fin de page, dans la grammaire du parcours.
 *
 * La maquette la reléguait en une ligne du pied de page (« BTS · équivalence »).
 * Une fois l'établissement et l'année ajoutés, cette ligne devenait une
 * énumération à points médians, illisible — Jérémie l'a refusée au premier
 * regard. La formation reprend donc la grille du parcours : l'année à gauche,
 * le diplôme en titre, puis son option, l'équivalence suisse et l'établissement.
 *
 * `displayProjection` ne porte déjà que `formation[dans_cv = true]` (AD-8) :
 * une entrée masquée dans `cv.yaml` n'arrive pas jusqu'ici, tout en restant
 * disponible pour l'agent. Ce composant n'a donc rien à filtrer — et surtout
 * rien à re-filtrer, ce qui déplacerait la décision hors de la liste blanche.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {yearOf} from './format';

export type EducationSectionProps = {
  readonly formation: DisplayProjection['formation'];
};

export async function EducationSection({formation}: EducationSectionProps) {
  const t = await getTranslations();
  if (formation.length === 0) return null;

  return (
    <section aria-labelledby="formation" className="pb-14">
      <h2
        id="formation"
        className="border-b border-rule pb-4 text-[13px] font-semibold tracking-[0.1em] text-ink-muted uppercase"
      >
        {t('sections.education')}
      </h2>

      <ol className="flex flex-col">
        {/* Un intitulé vide dans cette langue — la projection replie sur '' —
            n'a pas d'entrée à montrer : une année et une option orphelines
            diraient moins que rien. */}
        {formation
          .filter((diplome) => diplome.diplome !== '')
          .map((diplome) => {
          const annee = yearOf(diplome.annee);

          return (
            <li
              key={diplome.id}
              className="grid gap-x-8 gap-y-3 border-b border-rule-soft py-6 last:border-b-0 lg:grid-cols-12"
            >
              {/* Mêmes colonnes explicites que le parcours : une année absente
                  ne doit pas faire remonter le diplôme dans la première. */}
              {annee === undefined ? null : (
                <p className="text-[14px] text-ink-muted lg:col-span-2 lg:col-start-1 lg:pt-1">
                  {annee}
                </p>
              )}

              <div className="lg:col-span-6 lg:col-start-3">
                <h3 className="text-[19px] leading-snug font-semibold">{diplome.diplome}</h3>
                {diplome.option === undefined ? null : (
                  <p className="mt-0.5 text-[15px] text-ink-soft">
                    {t('education.option', {value: diplome.option})}
                  </p>
                )}
                {diplome.equivalence_suisse === undefined ? null : (
                  <p className="mt-0.5 text-[15px] text-ink-soft">
                    {t('education.equivalence', {value: diplome.equivalence_suisse})}
                  </p>
                )}
                {diplome.etablissement === undefined ? null : (
                  <p className="mt-2.5 text-[15px] text-ink-soft">{diplome.etablissement}</p>
                )}
                {/* Le scan du diplôme ne se sert pas (date et lieu de naissance) et
                    ne s'annonce plus : ligne « justificatif sur demande » retirée
                    le 2026-09-22 (décision de Jérémie). */}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
