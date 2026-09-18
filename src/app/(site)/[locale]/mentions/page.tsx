/**
 * « Mentions légales & confidentialité » — `/fr/mentions`, `/en/mentions`
 * (CAP-9, story 9) : la page vers laquelle l'assistant renvoie quand on
 * l'interroge sur les données (AD-4, règle 6 du prompt) ; les messages de
 * plafond et d'indisponibilité, eux, renvoient au contact direct (`#contact`).
 * Qui publie, où c'est hébergé, les deux cookies, ce que le journal conserve
 * et pourquoi, ce qui part chez le fournisseur du modèle — nommé dans le
 * texte, qui est inliné dans `app` : le garde textuel de
 * `tests/unit/api-chat.test.ts` fait de ces quatre fichiers sa seule
 * exception —, l'absence de traceur, les droits, la non-indexation.
 *
 * Même mécanique que `comment/page.tsx` : un fichier Markdown par langue,
 * importé en texte, et la fabrique `prosePage` pour tout le reste. Deux
 * marques dans le texte : `{name}`, rempli depuis le contenu, et
 * `{hebergeur}`, rempli depuis `HOSTING_PROVIDER` ci-dessous — vide tant que
 * l'hébergeur n'est pas donné, et la phrase se passe alors du nom.
 *
 * Le courriel ne fait pas exception à AD-8 : un moissonneur lit les mentions
 * légales comme le reste. Il passe par `ContactReveal`, le même bouton que la
 * section Contact de la page CV — inséré **après** le Markdown, donc sous sa
 * dernière rubrique, « Contact », dont le texte dit aussi que, sans
 * JavaScript, LinkedIn et GitHub restent joignables depuis la page CV.
 */
import {ContactReveal} from '../_components/contact-reveal';
import {prosePage} from '../_components/prose-page';
import mentionsEn from './mentions.en.md';
import mentionsFr from './mentions.fr.md';

// Le rendu reste à la requête (AD-2) : la barre lit le nom dans le contenu,
// et le document est journalisé comme une visite (AD-14).
export const dynamic = 'force-dynamic';

/** L'hébergeur du serveur, à donner par l'éditeur ; vide, les mentions n'en nomment aucun. */
const HOSTING_PROVIDER = '';

const page = prosePage({
  namespace: 'pages.mentions',
  body: {fr: mentionsFr, en: mentionsEn},
  hostingProvider: HOSTING_PROVIDER,
  after: (t) => (
    // `empty:hidden` : sans JavaScript, `ContactReveal` ne rend rien — et un
    // paragraphe vide laisserait un écart sous la rubrique.
    <p className="empty:hidden">
      <ContactReveal
        endpoint="/api/contact/email"
        labels={{
          reveal: t('email.reveal'),
          pending: t('email.pending'),
          label: t('email.label'),
          unavailable: t('email.unavailable')
        }}
      />
    </p>
  )
});

export const generateMetadata = page.generateMetadata;
export default page.Page;
