/**
 * La fiche d'un visiteur — `GET /admin/visiteurs/<ulid>` (CAP-7) : nom, note,
 * première visite, le formulaire nom + note, et toutes ses sessions. Un
 * identifiant qui n'est pas un ULID, ou inconnu, vaut la 404 de l'admin.
 */
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {isUlid} from '@/lib/ulid';
import {Breadcrumb} from '../../_components/breadcrumb';
import {VisitorForm} from '../../_components/forms';
import {SessionsTable} from '../../_components/sessions-table';
import {formatInstant, formatInteger, labelOrNull, visitorLabel} from '../../_lib/format';

export const dynamic = 'force-dynamic';

type Params = Promise<{id: string}>;

/** Le titre relit le visiteur : son nom ou son identifiant abrégé ; « Introuvable » sinon. */
export async function generateMetadata({params}: {params: Params}): Promise<Metadata> {
  const {id} = await params;
  if (!isUlid(id)) return {title: 'Introuvable'};
  const {findVisitor} = await import('@/journal');
  const visitor = findVisitor(id);
  return {title: visitor === undefined ? 'Introuvable' : `Visiteur ${visitorLabel(visitor.name, visitor.id)}`};
}

const DT = 'text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const DD = 'mt-0.5 break-words';
const H2 = 'font-serif text-[22px] leading-tight font-normal';

export default async function AdminVisitor({params}: {params: Params}) {
  const {id} = await params;
  if (!isUlid(id)) notFound();

  const {findVisitor, visitorSessions, VISITOR_NAME_MAX, VISITOR_NOTE_MAX, VISITOR_SESSIONS_MAX} =
    await import('@/journal');
  const visitor = findVisitor(id);
  if (visitor === undefined) notFound();
  const {sessions, total} = visitorSessions(id);
  const from = `/admin/visiteurs/${id}`;

  return (
    <main className="py-8">
      <Breadcrumb current="Visiteur" />
      <h1 className="mt-1 font-serif text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-normal" data-visitor-name>
        {visitorLabel(visitor.name, visitor.id)}
      </h1>
      <p className="mt-1 font-mono text-[13px] text-ink-muted">{visitor.id}</p>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-[15px] sm:grid-cols-3">
        <div>
          <dt className={DT}>Nom</dt>
          <dd className={DD}>{labelOrNull(visitor.name) ?? '—'}</dd>
        </div>
        <div>
          <dt className={DT}>Note</dt>
          <dd className={`${DD} whitespace-pre-wrap`} data-visitor-note>
            {labelOrNull(visitor.note) ?? '—'}
          </dd>
        </div>
        <div>
          <dt className={DT}>Première visite</dt>
          <dd className={DD}>{formatInstant(visitor.firstSeen, {seconds: true})}</dd>
        </div>
      </dl>

      <section className="mt-10" aria-labelledby="fiche-titre">
        <h2 id="fiche-titre" className={H2}>
          Nommer, annoter
        </h2>
        <div className="mt-4">
          <VisitorForm
            visitorId={visitor.id}
            name={visitor.name ?? ''}
            note={visitor.note ?? ''}
            nameMax={VISITOR_NAME_MAX}
            noteMax={VISITOR_NOTE_MAX}
            from={from}
          />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="sessions-titre">
        <h2 id="sessions-titre" className={H2}>
          Sessions
          <span className="ml-3 text-[14px] font-sans text-ink-muted">{formatInteger(total)}</span>
        </h2>
        {total > sessions.length ? (
          <p className="mt-2 text-[14px] text-ink-soft" data-sessions-truncated>
            Les {formatInteger(VISITOR_SESSIONS_MAX)} plus récentes sont montrées, sur {formatInteger(total)}.
          </p>
        ) : null}
        <div className="mt-4">
          <SessionsTable sessions={sessions} hideVisitor />
        </div>
      </section>
    </main>
  );
}
