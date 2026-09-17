/**
 * Les questions les plus posées — `GET /admin/questions` (CAP-7), sur toute
 * la période, deux classements de cinquante lignes :
 *  - les puces du premier écran, par identifiant d'entrée du corpus — le
 *    libellé affiché est la question **française** du corpus (`qaEntry('fr',
 *    id)`), l'identifiant à côté ; une entrée qui n'existe plus garde son
 *    identifiant seul ;
 *  - les questions libres et les annonces, par texte normalisé (minuscules,
 *    blancs réduits, deux cents premiers caractères), avec la sorte.
 *
 * Ce que les visiteurs ont tapé s'affiche en texte. `@/journal` et
 * `@/content` sont importés à l'appel, comme partout.
 */
import type {Metadata} from 'next';
import {formatInstant, formatInteger, KIND_LABELS} from '../_lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Questions'};

const TH = 'px-3 py-2 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const TD = 'px-3 py-2 align-top';
const H2 = 'font-serif text-[22px] leading-tight font-normal';

export default async function AdminQuestions() {
  const [{topQuestions}, {qaEntry}] = await Promise.all([import('@/journal'), import('@/content')]);
  const {hero, free} = topQuestions();

  return (
    <main className="py-8">
      <h1 className="font-serif text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-normal">
        Questions les plus posées
      </h1>
      <p className="mt-2 text-ink-soft">Sur toute la période du journal.</p>

      <section className="mt-8" aria-labelledby="puces-titre">
        <h2 id="puces-titre" className={H2}>
          Puces du premier écran
        </h2>
        {hero.length === 0 ? (
          <p className="mt-3 text-ink-soft">Aucune puce cliquée.</p>
        ) : (
          <table className="mt-4 w-full border-collapse text-[14px]" data-ranking="hero">
            <thead>
              <tr className="border-b border-rule-strong">
                <th scope="col" className={TH}>
                  Question
                </th>
                <th scope="col" className={TH}>
                  Identifiant
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Fois
                </th>
                <th scope="col" className={TH}>
                  Dernière fois
                </th>
              </tr>
            </thead>
            <tbody>
              {hero.map((row) => (
                <tr key={row.id} className="border-b border-rule-soft" data-question-id={row.id}>
                  <td className={TD}>{qaEntry('fr', row.id)?.question ?? '—'}</td>
                  <td className={`${TD} font-mono text-[13px] text-ink-muted`}>{row.id}</td>
                  <td className={`${TD} text-right tabular-nums`} data-count>
                    {formatInteger(row.count)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatInstant(row.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10" aria-labelledby="libres-titre">
        <h2 id="libres-titre" className={H2}>
          Questions libres et annonces
        </h2>
        {free.length === 0 ? (
          <p className="mt-3 text-ink-soft">Aucune question libre.</p>
        ) : (
          <table className="mt-4 w-full border-collapse text-[14px]" data-ranking="free">
            <thead>
              <tr className="border-b border-rule-strong">
                <th scope="col" className={TH}>
                  Texte
                </th>
                <th scope="col" className={TH}>
                  Sorte
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Fois
                </th>
                <th scope="col" className={TH}>
                  Dernière fois
                </th>
              </tr>
            </thead>
            <tbody>
              {free.map((row) => (
                <tr key={`${row.kind}:${row.text}`} className="border-b border-rule-soft">
                  <td className={`${TD} break-words`}>{row.text}</td>
                  <td className={TD}>{KIND_LABELS[row.kind]}</td>
                  <td className={`${TD} text-right tabular-nums`} data-count>
                    {formatInteger(row.count)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatInstant(row.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
