/**
 * La page CV — direction A. Il n'y a pas d'accueil distinct : cette page *est*
 * le CV.
 *
 * Deux règles gouvernent tout ce qui suit :
 *
 *  - **Tout le texte de CV vient de `displayProjection(lang)`**, et rien
 *    d'autre. Aucun composant n'écrit un nom, une date, un employeur ou une
 *    compétence ; ce que les composants écrivent — titres de sections, libellés
 *    des six questions, bouton du téléphone — vit dans `messages/*.json`.
 *    `tests/unit/page-projection.test.ts` refuse la moindre exception.
 *  - **L'ordre de lecture est celui de `CAP-1`** : identité, positionnement IA,
 *    assistant, puis seulement le parcours — donc l'historique WinDev *après*
 *    le repositionnement, jamais avant.
 *
 * `force-dynamic` n'est pas un réglage de performance. Sans lui, Next
 * pré-rendrait `/fr` et `/en` au build : le contenu de `CONTENT_DIR` serait figé
 * dans l'artefact au lieu d'être lu au démarrage (AD-2), et un redémarrage ne
 * suffirait plus à publier une correction du CV. Il faut **en plus** différer
 * l'import de `@/content` — voir le commentaire dans le corps de la fonction.
 */
import {hasLocale} from 'next-intl';
import {setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing} from '@/i18n/routing';
import {AssistantDock, DOCK_BAR_HEIGHT_CLASS} from './_components/assistant-dock';
import {AssistantPanel} from './_components/assistant-panel';
import {CareerSection} from './_components/career-section';
import {EducationSection} from './_components/education-section';
import {IdentityHeading} from './_components/identity-heading';
import {IdentityProfile} from './_components/identity-profile';
import {ReferencesSection} from './_components/references-section';
import {SiteHeader} from './_components/site-header';
import {SkillsSection} from './_components/skills-section';

export const dynamic = 'force-dynamic';

export default async function LocaleHomePage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  // Import **différé**, et non statique : `force-dynamic` empêche le *rendu*
  // au build, pas le **chargement** du module — Next lit ses exports pendant
  // « Collecting page data ». Un import statique entraînerait donc `@/env`,
  // dont le parsage Zod a lieu au chargement, et le build réclamerait une clé
  // API et un chemin de contenu, ce que `next.config.ts` refuse. Le spécifieur
  // reste un littéral, donc analysable par `tests/unit/layers.test.ts`.
  const {displayProjection} = await import('@/content');
  const cv = displayProjection(locale);

  return (
    // La marge basse réserve, sous `lg`, la hauteur de la barre fixe de
    // l'assistant : rien de la page ne doit rester caché dessous.
    <div className={`mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-[72px] ${DOCK_BAR_HEIGHT_CLASS} lg:pb-0`}>
      <SiteHeader identite={cv.identite} contact={cv.contact} locale={locale} />

      <main>
        {/* Le premier écran, mise en page validée le 2026-09-15 : le titre sur
            toute la largeur, puis le profil à gauche et l'assistant à droite
            (5/12). Sous `lg`, l'assistant n'est pas ici : il vit dans la barre
            fixe en bas d'écran (`AssistantDock`), pour que le CV vienne d'abord. */}
        <div className="flex flex-col gap-8 py-10 lg:gap-9 lg:py-14">
          <IdentityHeading identite={cv.identite} />
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">
              <IdentityProfile profil={cv.profil} experiences={cv.experiences} />
            </div>
            <div className="hidden lg:col-span-5 lg:block">
              <AssistantPanel titleId="assistant-titre" experiences={cv.experiences} />
            </div>
          </div>
        </div>

        <CareerSection experiences={cv.experiences} />
        <SkillsSection
          competences={cv.competences}
          atouts={cv.atouts}
          langues={cv.langues}
          identite={cv.identite}
          contact={cv.contact}
        />
        <EducationSection formation={cv.formation} />
        <ReferencesSection references={cv.references} />
      </main>

      <AssistantDock experiences={cv.experiences} />
    </div>
  );
}
