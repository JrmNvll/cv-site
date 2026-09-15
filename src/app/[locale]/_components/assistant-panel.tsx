/**
 * L'emplacement de l'assistant — compact, sous le titre, direction A révisée.
 *
 * Mise en page validée par Jérémie le 2026-09-15 : sur écran large, le panneau
 * occupe 5/12 du premier écran, juste sous le titre, à droite du profil ; sur
 * téléphone, il vit dans un tiroir ouvert depuis une barre fixe en bas d'écran
 * (`assistant-dock.tsx`), pour que le CV vienne d'abord. Le même composant
 * sert les deux — d'où `titleId` : deux copies dans le document, une visible
 * par largeur d'écran, et un identifiant ne peut pas être porté deux fois.
 *
 * **Inerte, et il le dit.** Les six questions et le champ de saisie sont là,
 * dessinés comme ils le seront ; rien ne répond encore (stories 5 et 6). Les
 * commandes sont donc `disabled` plutôt que muettes : un bouton qui ne fait
 * rien quand on clique dessus est pire qu'un bouton visiblement hors service, et
 * un état `disabled` est annoncé par un lecteur d'écran là où l'absence de
 * réaction ne l'est pas. Une ligne d'état, sous les commandes, dit pourquoi.
 *
 * **Les libellés sont de l'interface, pas du contenu** : ils vivent dans
 * `messages/*.json`. La correspondance libellé → entrée du corpus, elle, vit
 * dans `hero-questions.ts` — `content-contract.md` la fixe et prévient qu'elle
 * ne se devine pas.
 */
import {getTranslations} from 'next-intl/server';
import {HERO_ROWS, MATCH_QUESTION} from './hero-questions';

const CHIP =
  'max-w-full rounded-full border border-panel-rule bg-panel-raised px-3 py-1.5 text-left text-[13px] text-panel-ink disabled:cursor-not-allowed disabled:opacity-70';

export type AssistantPanelProps = {
  /** L'identifiant du titre, unique dans le document — `aria-labelledby`. */
  readonly titleId: string;
};

export async function AssistantPanel({titleId}: AssistantPanelProps) {
  const t = await getTranslations('assistant');

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-md bg-panel p-5 text-panel-ink sm:p-6"
    >
      <div className="flex items-center gap-2.5">
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
        <h2
          id={titleId}
          className="text-[12px] font-semibold tracking-[0.08em] text-panel-accent uppercase"
        >
          {t('eyebrow')}
        </h2>
      </div>

      <p className="mt-1 text-[13.5px] leading-relaxed text-panel-ink-soft">{t('intro')}</p>

      <div className="mt-3.5 flex flex-col gap-1.5">
        {HERO_ROWS.map((row) => (
          <div key={row.join('-')} className="flex flex-wrap gap-1.5">
            {row.map((id) => (
              <button key={id} type="button" disabled className={CHIP}>
                {t(`questions.${id}`)}
              </button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {/* La sixième : elle n'interroge pas le corpus, elle ouvrira
              l'évaluation d'adéquation (CAP-4). D'où l'accent. */}
          <button
            type="button"
            disabled
            className="max-w-full rounded-full border border-panel-accent bg-panel-accent px-3 py-1.5 text-left text-[13px] font-semibold text-panel disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t(`questions.${MATCH_QUESTION}`)}
          </button>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3 rounded-md border border-panel-rule bg-panel-sunken px-3 py-2">
        <input
          type="text"
          disabled
          placeholder={t('placeholder')}
          aria-label={t('eyebrow')}
          className="min-w-0 grow bg-transparent text-[14px] text-panel-ink placeholder:text-panel-ink-muted disabled:cursor-not-allowed"
        />
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-panel-accent"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>

      <p className="mt-2.5 text-[12px] text-panel-ink-muted">{t('inactive')}</p>
    </section>
  );
}
