/**
 * La 404 de l'admin, en français, dans le document de l'admin — ce que
 * `notFound()` déclenche pour une session ou un visiteur inconnus, et ce que
 * le catch-all `[...rest]` déclenche pour tout autre chemin sous `/admin`.
 */
import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <main className="flex min-h-[50vh] max-w-2xl flex-col justify-center gap-4 py-16">
      <h1 className="font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-tight font-normal">Introuvable</h1>
      <p className="text-ink-soft">
        Rien à cette adresse : la session ou le visiteur demandés n’existent pas dans le journal.
      </p>
      <p>
        <Link prefetch={false} href="/admin" className="text-accent underline-offset-4 hover:text-accent-strong hover:underline">
          Retour au tableau de bord
        </Link>
      </p>
    </main>
  );
}
