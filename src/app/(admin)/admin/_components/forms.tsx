/**
 * Les formulaires de l'admin — nommer un visiteur, étiqueter une adresse,
 * bloquer ou lever (story 13) — en HTML pur : `POST` vers `/admin/api/*`,
 * `303` en retour vers `from`. Aucun JavaScript, aucune Server Action (AD-10).
 * Les bornes viennent du journal, passées par la page : `maxLength` prévient,
 * la route refuse.
 *
 * Le formulaire du visiteur porte **toujours** le nom et la note : la route
 * écrit les deux, un champ absent effacerait l'autre.
 */
import type {BlockKind} from '@/journal';

const LABEL = 'block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted';
const INPUT =
  'mt-1 w-full rounded-sm border border-rule bg-surface-raised px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none';
const BUTTON =
  'mt-3 rounded-sm border border-accent px-4 py-2 text-[14px] text-accent hover:bg-surface-raised hover:text-accent-strong';
/**
 * Bloquer et lever ne sont pas des enregistrements comme les autres : ils
 * ferment ou rouvrent la porte. Le bouton le dit par sa couleur, et l'accent
 * reste réservé à ce qui ne détruit rien.
 */
const BUTTON_DANGER =
  'rounded-sm border border-rule-strong px-3 py-1.5 text-[13px] text-ink-soft hover:border-ink-soft hover:text-ink';

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

export type BlockFormProps = {
  /** La session dont on bloque l'auteur : elle donne les deux clés. */
  readonly sessionId: string;
  /** L'adresse de la session, telle quelle — pour la dire dans le bouton. */
  readonly ip: string;
  /** Faux pour `dev` et `unknown` : seul le cookie sera bloqué. */
  readonly ipBlockable: boolean;
  /** Vrai quand une des deux clés tient déjà : le geste ferme celle qui reste. */
  readonly dejaBloque?: boolean;
  readonly from: string;
};

/**
 * Bloquer l'auteur d'une session, d'un seul geste, sur ses deux clés. Le
 * bouton dit lesquelles, parce qu'une adresse qui ne désigne personne n'est
 * pas bloquée et qu'il ne faut pas laisser croire le contraire.
 */
export function BlockForm({sessionId, ip, ipBlockable, dejaBloque = false, from}: BlockFormProps) {
  return (
    <form
      method="post"
      action={`/admin/api/blocages/${sessionId}`}
      className="max-w-xl"
      aria-label="Bloquer ce visiteur"
    >
      <input type="hidden" name="from" value={from} />
      {dejaBloque ? (
        <p className="text-[13px] text-ink-soft">
          Une clé tient déjà ; ce geste ferme celle qui reste ouverte. Celle qui tient n’est pas réinscrite.
        </p>
      ) : null}
      <p className={`text-[13px] text-ink-soft${dejaBloque ? ' mt-2' : ''}`}>
        {ipBlockable ? (
          <>
            Ferme le site à ce visiteur : son cookie <strong>et</strong> son adresse ({ip}). En IPv6, c’est le
            préfixe <code>/64</code> de l’abonné qui est bloqué.
          </>
        ) : (
          <>
            Ferme le site à ce visiteur par son cookie seul : l’adresse « {ip} » ne désigne personne et n’est pas
            bloquée.
          </>
        )}
      </p>
      <p className="mt-1 text-[12px] text-ink-muted">
        Il recevra la page des adresses inconnues, sans savoir qu’il est bloqué. Un blocage se lève ; il ne
        s’efface pas. S’il supprime son cookie, seule l’adresse le retient.
      </p>
      <button type="submit" className={`${BUTTON_DANGER} mt-3`} data-block-submit>
        {dejaBloque ? 'Fermer la clé restante' : 'Bloquer ce visiteur'}
      </button>
    </form>
  );
}

export type LiftFormProps = {
  readonly kind: BlockKind;
  readonly value: string;
  readonly from: string;
};

/** Lever une clé — une seule, c'est tout l'intérêt (voir la route). */
export function LiftForm({kind, value, from}: LiftFormProps) {
  return (
    <form method="post" action="/admin/api/blocages/lever" aria-label={`Lever le blocage de ${value}`}>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="value" value={value} />
      <button type="submit" className={BUTTON_DANGER} data-lift-submit>
        Lever
      </button>
    </form>
  );
}
