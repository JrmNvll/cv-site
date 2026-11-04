/**
 * Les certifications — entre la formation et les références, comme sur le CV PDF.
 *
 * Même grille que le parcours et la formation : la date à gauche, l'intitulé en
 * titre, l'organisme dessous. Elle est écrite au mois près (« nov. 2026 »), la
 * forme du CV PDF — la formation, elle, n'affiche que l'année, parce qu'un
 * diplôme se date d'une année et une certification d'un jour.
 *
 * La seule particularité tient au lien de vérification. La page porte déjà des
 * liens sortants — les profils de la section Contact —, mais c'est le seul qui
 * mène vers une attestation tenue par un tiers : il s'ouvre à part, sans donner
 * la main à la page visée, et son intitulé accessible nomme la destination pour
 * qu'un lecteur d'écran sache où il part avant de cliquer.
 *
 * `displayProjection` ne porte que `certifications[dans_cv = true]` (AD-8) : une
 * entrée masquée dans `cv.yaml` n'arrive pas ici, tout en restant connue de
 * l'agent. Ce composant n'a donc rien à filtrer — et surtout rien à re-filtrer,
 * ce qui déplacerait la décision hors de la liste blanche.
 */
import {getLocale, getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {shortMonthYear} from './format';

export type CertificationsSectionProps = {
  readonly certifications: DisplayProjection['certifications'];
};

/** Le style des liens du site, repris tel quel de la section des compétences. */
const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';

/**
 * Le domaine d'une adresse, pour dire au visiteur où le lien l'emmène.
 *
 * Le schéma n'accepte qu'un domaine pointé et la projection préfixe toujours un
 * protocole, donc `new URL` ne devrait jamais échouer ici. Le repli sur
 * l'adresse entière n'est pas un garde-fou actif, c'est une ceinture : une
 * exception dans un composant serveur emporterait la page entière, et une
 * rubrique vaut mieux qu'un écran blanc.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function CertificationsSection({certifications}: CertificationsSectionProps) {
  const t = await getTranslations();
  const locale = await getLocale();
  if (certifications.length === 0) return null;

  return (
    <section aria-labelledby="certifications" className="pb-14">
      <h2
        id="certifications"
        className="border-b border-rule pb-4 text-[13px] font-semibold tracking-[0.1em] text-ink-muted uppercase"
      >
        {t('sections.certifications', {count: certifications.length})}
      </h2>

      <ol className="flex flex-col">
        {certifications.map((certification) => {
          const date = shortMonthYear(certification.date, locale);

          return (
            <li
              key={certification.id}
              className="grid gap-x-8 gap-y-3 border-b border-rule-soft py-6 last:border-b-0 lg:grid-cols-12"
            >
              {/* Mêmes colonnes explicites que le parcours : une date absente ne
                  doit pas faire remonter l'intitulé dans la première. */}
              {date === undefined ? null : (
                <p className="text-[14px] text-ink-muted lg:col-span-2 lg:col-start-1 lg:pt-1">
                  {date}
                </p>
              )}

              <div className="lg:col-span-6 lg:col-start-3">
                <h3 className="text-[19px] leading-snug font-semibold">{certification.intitule}</h3>
                <p className="mt-0.5 text-[15px] text-ink-soft">{certification.organisme}</p>

                {/* Sans adresse de vérification, la rubrique reste muette : une
                    certification s'affiche, elle ne se prouve pas toujours. */}
                {certification.verification === undefined ? null : (
                  <p className="mt-2.5 text-[15px]">
                    <a
                      href={certification.verification}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('certifications.verifyAria', {
                        name: certification.intitule,
                        host: hostOf(certification.verification)
                      })}
                      className={LINK}
                      data-certification-link={certification.id}
                    >
                      {t('certifications.verify')}
                    </a>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
