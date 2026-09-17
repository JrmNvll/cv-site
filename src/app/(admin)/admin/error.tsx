'use client';

/**
 * La page d'erreur de l'admin — ce que Next rend, dans le document de l'admin,
 * quand une page lève : un journal indisponible (base verrouillée, disque
 * plein), une lecture qui échoue. En français, avec le chemin vers le tableau
 * de bord et un bouton pour réessayer. Next impose un composant client ici ;
 * il ne fait rien d'autre que rendre ce texte.
 *
 * Le message de l'erreur n'est **pas** affiché : ce qu'une exception de
 * `node:sqlite` dit (un chemin, un verrou) appartient au journal applicatif,
 * que Next remplit de lui-même ; l'écran ne montre que le fait.
 */
import Link from 'next/link';

export default function AdminError({reset}: {readonly error: Error & {readonly digest?: string}; readonly reset: () => void}) {
  return (
    <main className="flex min-h-[50vh] max-w-2xl flex-col justify-center gap-4 py-16">
      <h1 className="font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-tight font-normal">Le journal ne répond pas</h1>
      <p className="text-ink-soft">
        La page n’a pas pu lire le journal des visites. Le détail est dans le journal applicatif du serveur ;
        rien n’a été écrit.
      </p>
      <p className="flex flex-wrap gap-x-5">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-sm border border-accent px-4 py-2 text-[14px] text-accent hover:bg-surface-raised hover:text-accent-strong"
        >
          Réessayer
        </button>
        <Link prefetch={false} href="/admin" className="self-center text-accent underline-offset-4 hover:text-accent-strong hover:underline">
          Retour au tableau de bord
        </Link>
      </p>
    </main>
  );
}
