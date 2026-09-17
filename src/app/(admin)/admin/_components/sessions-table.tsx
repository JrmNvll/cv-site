/**
 * La liste des sessions, telle que le tableau de bord et la fiche visiteur la
 * montrent : une ligne par session, du plus récent au plus ancien, ce que le
 * journal a joint (nom du visiteur, étiquette de l'adresse, compte et coût des
 * échanges). Tout est du texte : la provenance et le navigateur viennent d'un
 * en-tête que n'importe qui a pu écrire, ils ne deviennent jamais un lien.
 */
import Link from 'next/link';
import type {SessionSummary} from '@/journal';
import {addressLabel, formatInstant, formatMicroUsd, langLabel, visitorLabel} from '../_lib/format';

export type SessionsTableProps = {
  readonly sessions: readonly SessionSummary[];
  /** Vrai sur la fiche visiteur : la colonne du visiteur n'apporte rien. */
  readonly hideVisitor?: boolean;
};

const TH = 'px-3 py-2 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const TD = 'px-3 py-2 align-top';
const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';

export function SessionsTable({sessions, hideVisitor = false}: SessionsTableProps) {
  if (sessions.length === 0) {
    return <p className="py-6 text-ink-soft">Aucune session.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong">
            <th scope="col" className={TH}>
              Dernière activité
            </th>
            {hideVisitor ? null : (
              <th scope="col" className={TH}>
                Visiteur
              </th>
            )}
            <th scope="col" className={TH}>
              Adresse
            </th>
            <th scope="col" className={TH}>
              Langue
            </th>
            <th scope="col" className={TH}>
              Provenance
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Échanges
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Coût
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id} className="border-b border-rule-soft" data-session={session.id}>
              <td className={`${TD} whitespace-nowrap`}>
                <Link prefetch={false} href={`/admin/sessions/${session.id}`} className={LINK} title={session.id}>
                  {formatInstant(session.lastSeenAt)}
                </Link>
              </td>
              {hideVisitor ? null : (
                <td className={TD}>
                  <Link prefetch={false} href={`/admin/visiteurs/${session.visitorId}`} className={LINK} title={session.visitorId}>
                    {visitorLabel(session.visitorName, session.visitorId)}
                  </Link>
                </td>
              )}
              <td className={TD} title={session.ip}>
                {addressLabel(session.ipLabel, session.ip)}
              </td>
              <td className={TD}>{langLabel(session.lang)}</td>
              <td className={`${TD} max-w-[280px] break-all text-ink-soft`}>{session.referer ?? '—'}</td>
              <td className={`${TD} text-right tabular-nums`}>{session.exchanges}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatMicroUsd(session.costMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
