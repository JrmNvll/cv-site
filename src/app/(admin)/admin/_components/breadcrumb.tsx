/**
 * Le fil d'Ariane des pages de détail : le tableau de bord, puis la page
 * courante. Un `<nav>` nommé, pour qu'un lecteur d'écran le trouve.
 */
import Link from 'next/link';

const LINK = 'text-accent underline-offset-4 hover:text-accent-strong hover:underline';

export function Breadcrumb({current}: {readonly current: string}) {
  return (
    <nav aria-label="Fil d’Ariane" className="text-[13px] text-ink-muted">
      <ol className="flex flex-wrap items-center gap-x-2">
        <li>
          <Link prefetch={false} href="/admin" className={LINK}>
            Tableau de bord
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}
