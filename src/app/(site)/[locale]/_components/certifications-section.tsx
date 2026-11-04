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
 * Ce lien est une icône seule, à droite de l'intitulé (demande de Jérémie du
 * 2026-11-04). Sans texte visible, tout le sens passe par `aria-label`, repris
 * en `title` pour la souris ; et la zone cliquable reste à 24 px, le minimum de
 * WCAG 2.5.8, quelle que soit la taille du dessin.
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
          const verifyLabel =
            certification.verification === undefined
              ? undefined
              : t('certifications.verifyAria', {
                  name: certification.intitule,
                  host: hostOf(certification.verification)
                });

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
                {/* Le lien reste hors du `h3` : à l'intérieur, son intitulé
                    accessible s'ajouterait au nom du titre. */}
                <div className="flex items-start gap-1">
                  <h3 className="text-[19px] leading-snug font-semibold">{certification.intitule}</h3>

                  {/* Sans adresse de vérification, pas d'icône : une certification
                      s'affiche, elle ne se prouve pas toujours. */}
                  {certification.verification === undefined ? null : (
                    <a
                      href={certification.verification}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={verifyLabel}
                      title={verifyLabel}
                      className="mt-px inline-flex size-6 shrink-0 items-center justify-center text-accent hover:text-accent-strong"
                      data-certification-link={certification.id}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="15"
                        height="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
                <p className="mt-0.5 text-[15px] text-ink-soft">{certification.organisme}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
