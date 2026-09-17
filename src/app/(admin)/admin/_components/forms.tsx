/**
 * Les deux formulaires de l'admin — nommer un visiteur, étiqueter une adresse
 * — en HTML pur : `POST` vers `/admin/api/*`, `303` en retour vers `from`.
 * Aucun JavaScript, aucune Server Action (AD-10). Les bornes viennent du
 * journal, passées par la page : `maxLength` prévient, la route refuse.
 *
 * Le formulaire du visiteur porte **toujours** le nom et la note : la route
 * écrit les deux, un champ absent effacerait l'autre.
 */

const LABEL = 'block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const INPUT =
  'mt-1 w-full rounded-sm border border-rule bg-surface-raised px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none';
const BUTTON =
  'mt-3 rounded-sm border border-accent px-4 py-2 text-[14px] text-accent hover:bg-surface-raised hover:text-accent-strong';

export type VisitorFormProps = {
  readonly visitorId: string;
  /** Ce que la base porte, ou vide : la route écrit toujours une chaîne, jamais `NULL`. */
  readonly name: string;
  readonly note: string;
  readonly nameMax: number;
  readonly noteMax: number;
  /** La page à laquelle revenir après l'écriture. */
  readonly from: string;
};

export function VisitorForm({visitorId, name, note, nameMax, noteMax, from}: VisitorFormProps) {
  return (
    <form method="post" action={`/admin/api/visiteurs/${visitorId}`} className="max-w-xl" aria-label="Nommer le visiteur">
      <input type="hidden" name="from" value={from} />
      <label className={LABEL}>
        Nom
        <input type="text" name="name" maxLength={nameMax} defaultValue={name} className={INPUT} autoComplete="off" />
      </label>
      <label className={`${LABEL} mt-3`}>
        Note
        <textarea name="note" maxLength={noteMax} rows={4} defaultValue={note} className={INPUT} />
      </label>
      <p className="mt-1 text-[12px] text-ink-muted">
        Vider un champ retire ce qu’il portait ; rien n’est jamais supprimé du journal.
      </p>
      <button type="submit" className={BUTTON}>
        Enregistrer le visiteur
      </button>
    </form>
  );
}

export type AddressFormProps = {
  readonly ip: string;
  /** L'étiquette portée, ou vide si aucune n'a jamais été posée. */
  readonly label: string;
  readonly labelMax: number;
  readonly from: string;
};

export function AddressForm({ip, label, labelMax, from}: AddressFormProps) {
  return (
    <form
      method="post"
      action={`/admin/api/adresses/${encodeURIComponent(ip)}`}
      className="max-w-xl"
      aria-label="Étiqueter l’adresse"
    >
      <input type="hidden" name="from" value={from} />
      <label className={LABEL}>
        Étiquette de l’adresse {ip}
        <input type="text" name="label" maxLength={labelMax} defaultValue={label} className={INPUT} autoComplete="off" />
      </label>
      <p className="mt-1 text-[12px] text-ink-muted">
        L’étiquette suit l’adresse : toutes ses sessions, passées et à venir, la portent.
      </p>
      <button type="submit" className={BUTTON}>
        Enregistrer l’étiquette
      </button>
    </form>
  );
}
