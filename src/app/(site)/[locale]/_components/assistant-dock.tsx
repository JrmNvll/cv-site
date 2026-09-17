/**
 * L'assistant sur téléphone : une barre fixe en bas d'écran, un tiroir dessus.
 *
 * Sur un écran étroit, le panneau au-dessus du CV faisait 700 px avant la
 * première ligne du parcours. Décision de Jérémie du 2026-09-15 : le CV vient
 * d'abord, et l'assistant reste à un pouce — une barre fixe qui l'ouvre.
 *
 * Un `<details>` natif, pas un composant client : le tiroir s'ouvre et se
 * ferme **sans JavaScript**, le navigateur gère l'état, le clavier (Entrée,
 * Espace sur la barre) et l'annonce au lecteur d'écran. Le panneau est rendu
 * ici en seconde copie — la première, dans le premier écran, est masquée sous
 * `lg` ; celle-ci l'est au-dessus. Un `<details>` fermé ne rend pas son contenu
 * : les questions ne sont dans l'arbre accessible que tiroir ouvert.
 *
 * Le fond assombri est un pseudo-élément du `<details>` ouvert ; le tiroir
 * défile dans son propre cadre, la barre reste au-dessus pour refermer.
 */
import {getTranslations} from 'next-intl/server';
import {AssistantPanel, type AssistantPanelProps} from './assistant-panel';

/** Hauteur de la barre : ce que la page réserve en bas pour ne rien cacher dessous. */
export const DOCK_BAR_HEIGHT_CLASS = 'pb-14';

export type AssistantDockProps = Pick<AssistantPanelProps, 'experiences'>;

export async function AssistantDock({experiences}: AssistantDockProps) {
  const t = await getTranslations('assistant');

  return (
    <details className="group fixed inset-x-0 bottom-0 z-40 lg:hidden open:before:fixed open:before:inset-0 open:before:-z-10 open:before:bg-black/45 open:before:content-['']">
      <summary
        aria-label={t('eyebrow')}
        className="flex cursor-pointer list-none items-center justify-between gap-4 bg-panel px-5 py-3.5 text-[13px] font-semibold tracking-[0.06em] text-panel-ink uppercase shadow-[0_-8px_24px_rgba(0,0,0,0.25)] [&::-webkit-details-marker]:hidden"
      >
        <span className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0 text-panel-accent"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {t('eyebrow')}
        </span>
        {/* Le chevron se retourne quand le tiroir est ouvert. */}
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-panel-accent transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          <polyline points="6 15 12 9 18 15" />
        </svg>
      </summary>

      {/* Le tiroir : posé sur la barre, haut comme son contenu, jamais plus
          que l'écran moins une marge qui laisse voir la page. Il défile seul
          si les questions dépassent. */}
      <div className="fixed inset-x-0 bottom-[3.25rem] max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-t-2xl bg-panel shadow-[0_-12px_40px_rgba(0,0,0,0.35)]">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-panel-rule" aria-hidden="true" />
        <AssistantPanel titleId="assistant-titre-tiroir" experiences={experiences} />
      </div>
    </details>
  );
}
