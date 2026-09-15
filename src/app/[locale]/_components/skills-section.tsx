/**
 * Compétences, atouts, langues — et les informations pratiques.
 *
 * Absents de la maquette, qui ne montre que le premier écran et le parcours —
 * mais `CAP-1` demande que « identité, positionnement IA, trois expériences avec
 * réalisations **et compétences** » soient lisibles. Ils viennent donc après le
 * parcours, dans la même grammaire visuelle : un titre de section en petites
 * capitales, un filet, du contenu.
 *
 * Les informations pratiques — l'âge, la localité, le permis de travail — sont
 * ici et non dans le premier écran, à la demande de Jérémie : utiles à un
 * recruteur suisse, mais pas ce qui doit le retenir en premier. L'âge est celui
 * que la projection calcule à la requête ; la localité est un champ à part de
 * `cv.yaml`, jamais tirée de l'adresse postale (AD-8).
 *
 * Chaque bloc disparaît si sa liste est vide : un contenu qui ne dit rien ne
 * doit pas laisser un titre orphelin.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {joinParts} from './format';

export type SkillsSectionProps = {
  readonly competences: DisplayProjection['competences'];
  readonly atouts: DisplayProjection['atouts'];
  readonly langues: DisplayProjection['langues'];
  readonly identite: Pick<DisplayProjection['identite'], 'age' | 'permis'>;
  readonly contact: Pick<DisplayProjection['contact'], 'localite'>;
};

const SECTION_TITLE =
  'border-b border-rule pb-4 text-[13px] font-semibold tracking-[0.1em] text-ink-muted uppercase';

export async function SkillsSection({
  competences,
  atouts,
  langues,
  identite,
  contact
}: SkillsSectionProps) {
  const t = await getTranslations();
  const pratique = [
    identite.age === undefined ? undefined : t('practical.age', {age: identite.age}),
    contact.localite,
    identite.permis
  ].filter((line): line is string => line !== undefined);
  if (
    competences.length === 0 &&
    atouts.length === 0 &&
    langues.length === 0 &&
    pratique.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-12 pb-14">
      {competences.length === 0 ? null : (
        <section aria-labelledby="competences">
          <h2 id="competences" className={SECTION_TITLE}>
            {t('sections.skills')}
          </h2>
          <div className="grid gap-x-8 gap-y-6 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Des `div`, pas des `section` : une région ARIA par catégorie
                ferait cinq repères de plus dans la liste d'un lecteur d'écran,
                pour des sous-titres qu'un `h3` structure déjà. Une catégorie
                sans élément n'a pas de titre à afficher. */}
            {competences
              .filter((competence) => competence.items.length > 0)
              .map((competence) => (
              <div key={competence.id}>
                <h3 className="text-[15px] font-semibold text-ink">{competence.categorie}</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {competence.items.map((item) => (
                    <li
                      key={item}
                      className="rounded-[3px] bg-tag px-2.5 py-1 text-[12.5px] text-ink-soft"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {atouts.length === 0 ? null : (
          <section aria-labelledby="atouts">
            <h2 id="atouts" className={SECTION_TITLE}>
              {t('sections.assets')}
            </h2>
            <ul className="flex flex-col gap-1.5 pt-5 text-[15px] text-ink-soft">
              {atouts.map((atout) => (
                <li key={atout}>{atout}</li>
              ))}
            </ul>
          </section>
        )}

        {langues.length === 0 ? null : (
          <section aria-labelledby="langues-parlees">
            <h2 id="langues-parlees" className={SECTION_TITLE}>
              {t('sections.spokenLanguages')}
            </h2>
            <ul className="flex flex-col gap-1.5 pt-5 text-[15px] text-ink-soft">
              {langues.map((langue) => (
                <li key={`${langue.langue}/${langue.niveau}`}>
                  {joinParts([langue.langue, langue.niveau], ' — ')}
                </li>
              ))}
            </ul>
          </section>
        )}

        {pratique.length === 0 ? null : (
          <section aria-labelledby="pratique">
            <h2 id="pratique" className={SECTION_TITLE}>
              {t('sections.practical')}
            </h2>
            <ul className="flex flex-col gap-1.5 pt-5 text-[15px] text-ink-soft">
              {pratique.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
