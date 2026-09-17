/**
 * Le tableau de bord — `GET /admin` (CAP-7).
 *
 * En tête : la dépense du mois face au plafond, le nombre de sessions et
 * d'échanges. Puis les sessions les plus récentes, cinquante par page — par
 * défaut celles qui ont **au moins un échange** : les sondes de robots créent
 * une session par document servi et rien ne les efface (AD-7), elles se
 * filtrent à la lecture. `?tout=1` les montre aussi ; `?page=` pagine ; une
 * page hors bornes vaut la première, ou une page vide qui le dit.
 *
 * `@/journal` est importé **à l'appel**, comme `@/content` par la page CV : il
 * entraîne `@/env`, et le build ne doit réclamer aucune variable. Le plafond,
 * lui, vient de la table de prix — une constante sans dépendance.
 */
import Link from 'next/link';
import type {Metadata} from 'next';
import {MONTHLY_CAP_MICRO_USD} from '@/agent/pricing';
import {SessionsTable} from './_components/sessions-table';
import {formatInteger, formatMicroUsd, parsePage} from './_lib/format';

export const dynamic = 'force-dynamic';
/**
 * Absolu : le gabarit `%s — Administration` du layout ne s'applique qu'aux
 * segments enfants, pas à la page de son propre segment (règle de Next).
 */
export const metadata: Metadata = {title: {absolute: 'Tableau de bord — Administration'}};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STAT = 'rounded-sm border border-rule bg-surface-raised px-4 py-3';
const STAT_LABEL = 'text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const STAT_VALUE = 'mt-1 font-serif text-[26px] leading-tight tabular-nums';
const STAT_NOTE = 'mt-1 text-[12px] text-ink-muted';
const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';

/** L'adresse d'une page de la liste : `tout=1` conservé, `page` omis quand c'est la première. */
export function pageHref(page: number, tout: boolean): string {
  const query = new URLSearchParams();
  if (tout) query.set('tout', '1');
  if (page > 1) query.set('page', String(page));
  const search = query.toString();
  return search === '' ? '/admin' : `/admin?${search}`;
}

export default async function AdminDashboard({searchParams}: {searchParams: SearchParams}) {
  const params = await searchParams;
  const tout = (Array.isArray(params.tout) ? params.tout[0] : params.tout) === '1';
  const page = parsePage(params.page);

  const {journalStats, listSessions} = await import('@/journal');
  const stats = journalStats();
  const liste = listSessions({withExchanges: !tout, page});

  return (
    <main className="py-8">
      <h1 className="font-serif text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-normal">Tableau de bord</h1>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={STAT}>
          <dt className={STAT_LABEL}>Dépense du mois</dt>
          <dd className={STAT_VALUE} data-stat="spend">
            {formatMicroUsd(stats.monthSpendMicroUsd)}
            <span className="text-[15px] text-ink-muted"> / {formatMicroUsd(MONTHLY_CAP_MICRO_USD)}</span>
          </dd>
          <dd className={STAT_NOTE}>Depuis le 1er du mois (UTC), réservations en cours comprises.</dd>
        </div>
        <div className={STAT}>
          <dt className={STAT_LABEL}>Sessions</dt>
          <dd className={STAT_VALUE} data-stat="sessions">
            {formatInteger(stats.sessions)}
          </dd>
          <dd className={STAT_NOTE}>Toutes, depuis le début — sondes sans échange comprises.</dd>
        </div>
        <div className={STAT}>
          <dt className={STAT_LABEL}>Échanges</dt>
          <dd className={STAT_VALUE} data-stat="exchanges">
            {formatInteger(stats.exchanges)}
          </dd>
          <dd className={STAT_NOTE}>Puces, questions et annonces, tout statut, depuis le début.</dd>
        </div>
      </dl>

      <section className="mt-10" aria-labelledby="sessions-titre">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="sessions-titre" className="font-serif text-[22px] leading-tight font-normal">
            {tout ? 'Toutes les sessions' : 'Sessions avec au moins un échange'}
            <span className="ml-3 text-[14px] font-sans text-ink-muted">{formatInteger(liste.total)}</span>
          </h2>
          <p className="text-[14px]">
            {tout ? (
              <Link prefetch={false} href={pageHref(1, false)} className={LINK}>
                Ne montrer que les sessions avec échange
              </Link>
            ) : (
              <Link prefetch={false} href={pageHref(1, true)} className={LINK}>
                Montrer toutes les sessions, sondes comprises
              </Link>
            )}
          </p>
        </div>

        <div className="mt-4">
          <SessionsTable sessions={liste.sessions} />
        </div>

        <nav className="mt-4 flex items-center justify-between text-[14px]" aria-label="Pages">
          <p>
            {liste.page > 1 ? (
              <Link prefetch={false} href={pageHref(liste.page - 1, tout)} className={LINK} rel="prev">
                ← Page précédente
              </Link>
            ) : null}
          </p>
          <p className="text-ink-muted">
            Page {liste.page} sur {liste.pageCount}
          </p>
          <p>
            {liste.page < liste.pageCount ? (
              <Link prefetch={false} href={pageHref(liste.page + 1, tout)} className={LINK} rel="next">
                Page suivante →
              </Link>
            ) : null}
          </p>
        </nav>
      </section>
    </main>
  );
}
