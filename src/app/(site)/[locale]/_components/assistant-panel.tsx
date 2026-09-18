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
 * **Le cadre est serveur, le reste est client.** Titre et intro sont rendus
 * ici ; les six puces, le champ libre, la zone de l'annonce, la zone de
 * réponse et la ligne d'état vivent dans `hero-questions-client.tsx`, qui ne
 * reçoit que des libellés et des identifiants — une réponse arrive par une
 * route, après un geste, jamais dans le HTML servi. Sans JavaScript, puces et
 * champ restent `disabled` plutôt que muets : un bouton qui ne fait rien quand
 * on clique dessus est pire qu'un bouton visiblement hors service, et un état
 * `disabled` est annoncé par un lecteur d'écran. La ligne d'état le dit ; une
 * fois hydraté, tout répond.
 *
 * **Les libellés sont de l'interface, pas du contenu** : ils vivent dans
 * `messages/*.json`. La correspondance libellé → entrée du corpus, elle, vit
 * dans `hero-questions.ts` — `content-contract.md` la fixe et prévient qu'elle
 * ne se devine pas. Le libellé de `wd-02` porte un nombre d'années **calculé**
 * depuis les expériences (`careerYears`), jamais écrit : la maquette disait
 * « 20 ans », et ce chiffre aurait dérivé d'un an chaque année.
 */
import {getLocale, getTranslations} from 'next-intl/server';
import {careerYears, type CountableExperience} from './format';
import {HERO_ROWS, MATCH_QUESTION, YEARS_QUESTION} from './hero-questions';
import {HeroQuestionsClient} from './hero-questions-client';

export type AssistantPanelProps = {
  /** L'identifiant du titre, unique dans le document — `aria-labelledby`. */
  readonly titleId: string;
  /** Les expériences projetées : le libellé de `wd-02` en déduit ses années. */
  readonly experiences: readonly CountableExperience[];
};

export async function AssistantPanel({titleId, experiences}: AssistantPanelProps) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);

  // Sans date lisible dans les expériences, il n'y a pas de nombre à écrire :
  // un libellé sans chiffre plutôt qu'un chiffre inventé.
  const years = careerYears(experiences, new Date());
  const label = (id: string): string => {
    if (id !== YEARS_QUESTION) return t(`assistant.questions.${id}`);
    return years === undefined
      ? t('assistant.yearsUnknown')
      : t(`assistant.questions.${id}`, {years});
  };
  const rows = HERO_ROWS.map((row) => row.map((id) => ({id, label: label(id)})));

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
          {t('assistant.eyebrow')}
        </h2>
      </div>

      <p className="mt-1 text-[13.5px] leading-relaxed text-panel-ink-soft">{t('assistant.intro')}</p>

      <HeroQuestionsClient
        lang={locale}
        rows={rows}
        matchLabel={t(`assistant.questions.${MATCH_QUESTION}`)}
        labels={{
          loading: t('assistant.loading'),
          answerSource: t('assistant.answerSource'),
          answerModel: t('assistant.answerModel'),
          back: t('assistant.back'),
          withoutScript: t('assistant.withoutScript'),
          placeholder: t('assistant.placeholder'),
          questionLabel: t('assistant.questionLabel'),
          send: t('assistant.send'),
          matchTitle: t('assistant.matchTitle'),
          matchZoneLabel: t('assistant.matchLabel'),
          matchIntro: t('assistant.matchIntro'),
          matchPlaceholder: t('assistant.matchPlaceholder'),
          matchSend: t('assistant.matchSend'),
          matchBack: t('assistant.matchBack'),
          contact: t('sections.contact'),
          privacy: t('footer.mentions')
        }}
        privacyHref={`/${locale}/mentions`}
        errors={{
          unavailable: t('errors.unavailable'),
          invalid_input: t('errors.invalid_input'),
          content_unavailable: t('errors.content_unavailable'),
          no_visitor: t('errors.no_visitor'),
          rate_limited: t('errors.rate_limited'),
          cap_reached: t('errors.cap_reached'),
          model_unavailable: t('errors.model_unavailable')
        }}
      />
    </section>
  );
}
