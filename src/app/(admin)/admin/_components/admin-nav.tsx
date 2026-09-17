'use client';

/**
 * La navigation de l'admin : deux liens, celui de la section courante marqué
 * `aria-current="page"`. Un composant client pour la seule raison que le
 * chemin courant n'est lisible que par `usePathname()` — rendu côté serveur
 * avec le bon attribut, il n'a besoin d'aucun JavaScript pour être juste.
 * `Link` ne fait que rendre une ancre, sans préchargement.
 */
import Link from 'next/link';
import {usePathname} from 'next/navigation';

const NAV = [
  {href: '/admin', label: 'Tableau de bord'},
  {href: '/admin/questions', label: 'Questions'}
] as const;

/** La section d'un chemin : `/admin/questions` pour tout ce qui est dessous, `/admin` pour le reste. */
export function currentSection(pathname: string): string {
  return pathname === '/admin/questions' || pathname.startsWith('/admin/questions/') ? '/admin/questions' : '/admin';
}

export function AdminNav() {
  const section = currentSection(usePathname());
  return (
    <nav aria-label="Administration">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
        {NAV.map(({href, label}) => (
          <li key={href}>
            <Link
              prefetch={false}
              href={href}
              aria-current={href === section ? 'page' : undefined}
              className="text-accent underline-offset-4 hover:text-accent-strong hover:underline aria-[current]:text-ink aria-[current]:underline"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
