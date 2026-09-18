/**
 * Une page de prose : un titre, un corps Markdown, et ce qui vient après —
 * le bouton du courriel sur les mentions, rien sur l'autre (story 9).
 *
 * Le corps est un fichier Markdown du dépôt, un par page et par langue,
 * rendu par `renderMarkdown` — le sous-ensemble du corpus, étendu de ce que
 * la prose exige : titres `##`/`###` et liens sûrs. Le titre de la page (`h1`)
 * vient des messages d'interface, pas du fichier : c'est lui qui nomme la page
 * dans l'onglet, le pied de page et le titre. Le fichier commence donc à son
 * premier paragraphe.
 *
 * La grammaire visuelle est celle du CV : titres de section en petites
 * capitales sous un filet, texte de lecture à la taille du corps. Tout est
 * porté par des variantes descendantes d'une seule classe : le Markdown rend
 * des éléments nus.
 */
import type {ReactNode} from 'react';
import {renderMarkdown} from './markdown';

export type ProseArticleProps = {
  readonly title: string;
  /** Le corps, en Markdown — le contenu d'un fichier `*.md` du dépôt. */
  readonly body: string;
  /** Après le corps, sous sa dernière rubrique. */
  readonly children?: ReactNode;
};

const PROSE =
  'flex flex-col gap-4 text-[16px] leading-[1.7] text-ink ' +
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-accent-strong ' +
  '[&_em]:italic [&_strong]:font-semibold ' +
  '[&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-rule [&_h2]:pb-3 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:tracking-[0.1em] [&_h2]:text-ink-muted [&_h2]:uppercase ' +
  '[&_h3]:mt-2 [&_h3]:text-[17px] [&_h3]:font-semibold ' +
  '[&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6';

export function ProseArticle({title, body, children}: ProseArticleProps) {
  return (
    <article className="max-w-[42em] py-10 lg:py-14">
      <h1 className="font-serif text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.15] font-normal tracking-[-0.01em] text-balance">
        {title}
      </h1>
      <div className={`mt-8 ${PROSE}`}>
        {renderMarkdown(body, {headings: true, links: true})}
        {children}
      </div>
    </article>
  );
}
