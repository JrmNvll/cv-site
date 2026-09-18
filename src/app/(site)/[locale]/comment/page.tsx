/**
 * « Comment ce site est construit » — `/fr/comment`, `/en/comment` (CAP-9,
 * story 9) : ce qu'un responsable technique doit pouvoir lire sans interroger
 * l'assistant — la source unique, l'ancrage, les garde-fous, ce que le site
 * conserve, la technique, la méthode.
 *
 * Le texte est un fichier Markdown par langue, à côté de cette page — pas un
 * message d'interface, pas du contenu privé : une page de prose se relit comme
 * un document, et elle ne dit rien que la page CV ne montre déjà — le nom y
 * est une marque, `{name}`, remplie depuis le contenu. Il arrive par un import
 * statique de texte (règle `*.md` de `next.config.ts`, chargeur
 * `raw-text-loader.cjs`, déclaration `src/types/markdown.d.ts`). Tout le reste
 * — langue, métadonnées, coquille, rendu — est la fabrique `prosePage`.
 */
import {prosePage} from '../_components/prose-page';
import commentEn from './comment.en.md';
import commentFr from './comment.fr.md';

// Le rendu reste à la requête (AD-2) : la barre lit le nom dans le contenu,
// et le document est journalisé comme une visite (AD-14).
export const dynamic = 'force-dynamic';

const page = prosePage({namespace: 'pages.comment', body: {fr: commentFr, en: commentEn}});

export const generateMetadata = page.generateMetadata;
export default page.Page;
