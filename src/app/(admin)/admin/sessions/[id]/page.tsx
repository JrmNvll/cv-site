/**
 * Le détail d'une session — `GET /admin/sessions/<ulid>` (CAP-7).
 *
 * La session et son visiteur, l'adresse et son étiquette, puis **tous** ses
 * échanges dans l'ordre, toute sorte et tout statut : ce que le visiteur a
 * tapé s'affiche en **texte** ; la réponse — celle du modèle ou du corpus —
 * passe par `renderMarkdown`, le même sous-ensemble que le panneau du site,
 * jamais du HTML injecté. Deux formulaires : nommer le visiteur, étiqueter
 * l'adresse. Un identifiant qui n'est pas un ULID, ou inconnu, vaut la 404 de
 * l'admin.
 */
import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {renderMarkdown} from '@/app/(site)/[locale]/_components/markdown';
import type {Exchange} from '@/journal';
import {isUlid} from '@/lib/ulid';
import {Breadcrumb} from '../../_components/breadcrumb';
import {AddressForm, VisitorForm} from '../../_components/forms';
import {
  addressLabel,
  formatInstant,
  formatInteger,
  formatLatency,
  formatMicroUsd,
  KIND_LABELS,
  labelOrNull,
  langLabel,
  STATUS_LABELS,
  visitorLabel
} from '../../_lib/format';

export const dynamic = 'force-dynamic';

type Params = Promise<{id: string}>;

/** Le titre relit la session : « Introuvable » quand elle ne l'est pas — le titre d'une 404. */
export async function generateMetadata({params}: {params: Params}): Promise<Metadata> {
  const {id} = await params;
  if (!isUlid(id)) return {title: 'Introuvable'};
  const {findSession} = await import('@/journal');
  const session = findSession(id);
  return {title: session === undefined ? 'Introuvable' : `Session du ${formatInstant(session.startedAt)}`};
}

const DT = 'text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const DD = 'mt-0.5 break-words';
const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';
const H2 = 'font-serif text-[22px] leading-tight font-normal';

/** Une réponse à rendre : `done` ou une erreur avec un texte partiel ; rien pour `pending` et `cap_reached`. */
function answerOf(exchange: Exchange): string | null {
  if (exchange.status === 'pending' || exchange.status === 'cap_reached') return null;
  const text = exchange.answer?.trim() ?? '';
  return text === '' ? null : text;
}

function ExchangeCard({exchange, rank}: {exchange: Exchange; rank: number}) {
  const answer = answerOf(exchange);
  return (
    <article
      className="rounded-sm border border-rule bg-surface-raised p-4"
      data-exchange={exchange.id}
      data-kind={exchange.kind}
      data-status={exchange.status}
      aria-labelledby={`echange-${rank}`}
    >
      <p id={`echange-${rank}`} className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-ink-muted">
        <span className="font-medium text-ink">#{rank}</span>
        <span>{KIND_LABELS[exchange.kind]}</span>
        <span>{STATUS_LABELS[exchange.status]}</span>
        <span>{formatInstant(exchange.at, {seconds: true})}</span>
      </p>
      <h3 className="sr-only">Question</h3>
      <p className="mt-2 whitespace-pre-wrap break-words font-medium" data-question>
        {exchange.question}
      </p>
      {answer === null ? null : (
        <div className="mt-3 border-t border-rule-soft pt-3 text-ink-soft [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5" data-answer>
          {renderMarkdown(answer)}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-rule-soft pt-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className={DT}>Sources</dt>
          <dd className={DD} data-sources>
            {exchange.sources === null || exchange.sources.length === 0 ? '—' : exchange.sources.join(', ')}
          </dd>
        </div>
        <div>
          <dt className={DT}>Citations</dt>
          <dd className={DD}>{exchange.citationOk === null ? '—' : exchange.citationOk ? 'en ordre' : 'à revoir'}</dd>
        </div>
        <div>
          <dt className={DT}>Coût</dt>
          <dd className={`${DD} tabular-nums`}>{formatMicroUsd(exchange.costMicroUsd)}</dd>
        </div>
        <div>
          <dt className={DT}>Latence</dt>
          <dd className={`${DD} tabular-nums`}>{formatLatency(exchange.latencyMs)}</dd>
        </div>
        <div>
          <dt className={DT}>Jetons en entrée</dt>
          <dd className={`${DD} tabular-nums`}>{formatInteger(exchange.inputTokens)}</dd>
        </div>
        <div>
          <dt className={DT}>Jetons en sortie</dt>
          <dd className={`${DD} tabular-nums`}>{formatInteger(exchange.outputTokens)}</dd>
        </div>
        <div>
          <dt className={DT}>Cache lu</dt>
          <dd className={`${DD} tabular-nums`}>{formatInteger(exchange.cacheReadTokens)}</dd>
        </div>
        <div>
          <dt className={DT}>Cache écrit</dt>
          <dd className={`${DD} tabular-nums`}>{formatInteger(exchange.cacheCreationTokens)}</dd>
        </div>
      </dl>
    </article>
  );
}

export default async function AdminSession({params}: {params: Params}) {
  const {id} = await params;
  if (!isUlid(id)) notFound();

  const {findSession, findVisitor, ipLabel, sessionExchanges, IP_LABEL_MAX, VISITOR_NAME_MAX, VISITOR_NOTE_MAX} =
    await import('@/journal');
  const session = findSession(id);
  if (session === undefined) notFound();
  const visitor = findVisitor(session.visitorId);
  const etiquette = ipLabel(session.ip);
  const echanges = sessionExchanges(id);
  const from = `/admin/sessions/${id}`;

  return (
    <main className="py-8">
      <Breadcrumb current="Session" />
      <h1 className="mt-1 font-serif text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-normal">
        Session du {formatInstant(session.startedAt)}
      </h1>
      <p className="mt-1 font-mono text-[13px] text-ink-muted">{session.id}</p>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-[15px] sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className={DT}>Visiteur</dt>
          <dd className={DD}>
            <Link prefetch={false} href={`/admin/visiteurs/${session.visitorId}`} className={LINK} data-visitor>
              {visitorLabel(visitor?.name, session.visitorId)}
            </Link>
            {visitor === undefined ? null : (
              <span className="text-ink-muted"> · première visite le {formatInstant(visitor.firstSeen)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className={DT}>Note</dt>
          <dd className={`${DD} whitespace-pre-wrap`}>{labelOrNull(visitor?.note) ?? '—'}</dd>
        </div>
        <div>
          <dt className={DT}>Adresse</dt>
          <dd className={DD} data-address>
            {addressLabel(etiquette?.label, session.ip)}
            {labelOrNull(etiquette?.label) === null ? null : <span className="text-ink-muted"> · {session.ip}</span>}
          </dd>
        </div>
        <div>
          <dt className={DT}>Navigateur</dt>
          <dd className={`${DD} text-ink-soft`}>{session.userAgent ?? '—'}</dd>
        </div>
        <div>
          <dt className={DT}>Provenance</dt>
          <dd className={`${DD} break-all text-ink-soft`}>{session.referer ?? '—'}</dd>
        </div>
        <div>
          <dt className={DT}>Langue</dt>
          <dd className={DD}>{langLabel(session.lang)}</dd>
        </div>
        <div>
          <dt className={DT}>Début</dt>
          <dd className={DD}>{formatInstant(session.startedAt, {seconds: true})}</dd>
        </div>
        <div>
          <dt className={DT}>Dernière activité</dt>
          <dd className={DD}>{formatInstant(session.lastSeenAt, {seconds: true})}</dd>
        </div>
      </dl>

      <section className="mt-10" aria-labelledby="echanges-titre">
        <h2 id="echanges-titre" className={H2}>
          Échanges
          <span className="ml-3 text-[14px] font-sans text-ink-muted">{echanges.length}</span>
        </h2>
        {echanges.length === 0 ? (
          <p className="mt-3 text-ink-soft">Aucun échange : une visite sans question.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {echanges.map((exchange, index) => (
              <ExchangeCard key={exchange.id} exchange={exchange} rank={index + 1} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2" aria-labelledby="formulaires-titre">
        <h2 id="formulaires-titre" className={`${H2} lg:col-span-2`}>
          Nommer, étiqueter
        </h2>
        <VisitorForm
          visitorId={session.visitorId}
          name={visitor?.name ?? ''}
          note={visitor?.note ?? ''}
          nameMax={VISITOR_NAME_MAX}
          noteMax={VISITOR_NOTE_MAX}
          from={from}
        />
        <AddressForm ip={session.ip} label={etiquette?.label ?? ''} labelMax={IP_LABEL_MAX} from={from} />
      </section>
    </main>
  );
}
