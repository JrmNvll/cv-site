/**
 * Les blocages — `GET /admin/blocages` (story 13). Le registre entier, du plus
 * récent au plus ancien, **levés compris** : c'est un journal d'audit, et une
 * levée se lit comme une décision, pas comme un oubli (AD-7 n'efface rien).
 *
 * Deux sortes de clés sur la même liste : le cookie d'un visiteur, et l'adresse
 * — qui est en IPv6 le préfixe `/64` de l'abonné, pas l'adresse exacte, parce
 * que celle-ci tourne. Chaque clé qui tient porte son bouton « Lever », une par
 * une : rouvrir une adresse partagée sans rouvrir le cookie est tout l'intérêt.
 *
 * Un blocage se pose depuis la fiche d'une session, pas ici : c'est là que
 * Jérémie voit ce qui l'a motivé.
 *
 * `@/journal` est importé à l'appel, comme partout.
 */
import type {Metadata} from 'next';
import Link from 'next/link';
import {LiftForm} from '../_components/forms';
import {formatInstant} from '../_lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Blocages'};

const TH = 'px-3 py-2 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const TD = 'px-3 py-2 align-top';
const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';

/** « cookie » et « adresse » : ce que Jérémie a sous les yeux, pas le nom de la colonne. */
const SORTES = {visitor: 'cookie', ip: 'adresse'} as const;

export default async function AdminBlocages() {
  const {listBlocks, BLOCKS_MAX} = await import('@/journal');
  const {blocks: blocages, total} = listBlocks();
  const tiennent = blocages.filter((blocage) => blocage.liftedAt === null).length;
  const from = '/admin/blocages';

  return (
    <main className="py-8">
      <h1 className="font-serif text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-normal">Blocages</h1>
      <p className="mt-2 text-ink-soft">
        {tiennent === 0
          ? 'Aucun blocage en vigueur.'
          : `${tiennent} clé${tiennent > 1 ? 's' : ''} en vigueur, sur ${total} inscrite${total > 1 ? 's' : ''} depuis le début.`}
        {total > blocages.length ? ` Les ${BLOCKS_MAX} plus récentes sont listées.` : ''}
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">
        Un visiteur bloqué reçoit la page des adresses inconnues, sur le CV comme sur l’assistant, et n’atteint
        jamais le modèle. S’il supprime son cookie, seule l’adresse le retient — c’est la limite acceptée du
        dispositif. Un blocage se pose depuis la fiche d’une session.
      </p>

      {blocages.length === 0 ? (
        <p className="mt-8 text-ink-soft">Rien à afficher.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-rule-strong">
                <th scope="col" className={TH}>
                  Posé le
                </th>
                <th scope="col" className={TH}>
                  Sorte
                </th>
                <th scope="col" className={TH}>
                  Clé
                </th>
                <th scope="col" className={TH}>
                  Depuis
                </th>
                <th scope="col" className={TH}>
                  État
                </th>
              </tr>
            </thead>
            <tbody>
              {blocages.map((blocage) => (
                <tr key={blocage.id} className="border-b border-rule-soft" data-block={blocage.id}>
                  <td className={`${TD} whitespace-nowrap`}>{formatInstant(blocage.at, {seconds: true})}</td>
                  <td className={TD} data-block-kind>
                    {SORTES[blocage.kind]}
                  </td>
                  {/* Du texte : une clé d'adresse vient du journal, un
                      identifiant de visiteur d'un cookie. Jamais un lien. */}
                  <td className={`${TD} font-mono text-[13px] break-all`} data-block-value>
                    {blocage.value}
                  </td>
                  <td className={TD}>
                    {blocage.fromSession === null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <Link prefetch={false} href={`/admin/sessions/${blocage.fromSession}`} className={LINK}>
                        la session
                      </Link>
                    )}
                  </td>
                  <td className={TD} data-block-state>
                    {blocage.liftedAt === null ? (
                      <div className="flex items-center gap-3">
                        <span>En vigueur</span>
                        <LiftForm kind={blocage.kind} value={blocage.value} from={from} />
                      </div>
                    ) : (
                      <span className="text-ink-muted">Levé le {formatInstant(blocage.liftedAt, {seconds: true})}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
