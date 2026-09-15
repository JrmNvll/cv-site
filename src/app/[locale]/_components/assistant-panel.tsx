/**
 * L'emplacement de l'assistant — la moitié du premier écran, direction A.
 *
 * **Inerte, et il le dit.** Les six questions et le champ de saisie sont là,
 * dessinés comme ils le seront ; rien ne répond encore (stories 5 et 6). Les
 * commandes sont donc `disabled` plutôt que muettes : un bouton qui ne fait
 * rien quand on clique dessus est pire qu'un bouton visiblement hors service, et
 * un état `disabled` est annoncé par un lecteur d'écran là où l'absence de
 * réaction ne l'est pas. Une ligne d'état, sous les commandes, dit pourquoi.
 *
 * Il est construit maintenant et pas à la story 6 parce que la direction A fait
 * reposer le premier écran sur sa présence : une page bâtie sans lui, puis
 * réaménagée, serait faite deux fois.
 *
 * **Les libellés sont de l'interface, pas du contenu** : ils vivent dans
 * `messages/*.json`. La correspondance libellé → entrée du corpus, elle, vit
 * dans `hero-questions.ts` — `content-contract.md` la fixe et prévient qu'elle
 * ne se devine pas.
 */
import {getTranslations} from 'next-intl/server';
import {HERO_ROWS, MATCH_QUESTION} from './hero-questions';

const CHIP =
  'max-w-full rounded-full border border-panel-rule bg-panel-raised px-4 py-2 text-left text-[14px] text-panel-ink disabled:cursor-not-allowed disabled:opacity-70';

export async function AssistantPanel() {
  const t = await getTranslations('assistant');

  return (
    <section
      aria-labelledby="assistant-titre"
      className="flex flex-col rounded-md bg-panel p-6 text-panel-ink sm:p-8"
    >
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
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
          id="assistant-titre"
          className="text-[13px] font-semibold tracking-[0.08em] text-panel-accent uppercase"
        >
          {t('eyebrow')}
        </h2>
      </div>

      <p className="mt-1.5 max-w-[42ch] text-[15px] leading-relaxed text-panel-ink-soft">
        {t('intro')}
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {HERO_ROWS.map((row) => (
          <div key={row.join('-')} className="flex flex-wrap gap-2">
            {row.map((id) => (
              <button key={id} type="button" disabled className={CHIP}>
                {t(`questions.${id}`)}
              </button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {/* La sixième : elle n'interroge pas le corpus, elle ouvrira
              l'évaluation d'adéquation (CAP-4). D'où l'accent. */}
          <button
            type="button"
            disabled
            className="max-w-full rounded-full border border-panel-accent bg-panel-accent px-4 py-2 text-left text-[14px] font-semibold text-panel disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t(`questions.${MATCH_QUESTION}`)}
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-md border border-panel-rule bg-panel-sunken px-4 py-3">
        <input
          type="text"
          disabled
          placeholder={t('placeholder')}
          aria-label={t('eyebrow')}
          className="min-w-0 grow bg-transparent text-[15px] text-panel-ink placeholder:text-panel-ink-muted disabled:cursor-not-allowed"
        />
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
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

      <p className="mt-3 text-[13px] text-panel-ink-muted">{t('inactive')}</p>
    </section>
  );
}
