/**
 * Le catch-all de l'admin : tout chemin sous `/admin` qui ne correspond à
 * aucune page arrive ici et déclenche `notFound()` — donc la 404 de l'admin,
 * en français, dans son document, plutôt que la 404 globale de Next.
 */
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Introuvable'};

export default function AdminCatchAll(): never {
  notFound();
}
