/**
 * Le titre — la première chose lue, sur toute la largeur.
 *
 * Mise en page validée par Jérémie le 2026-09-15 : la photo à gauche, le titre
 * qui court sur toute la largeur du premier écran, le sous-titre dessous. Le
 * titre porte le positionnement (`CAP-1`), il est donc le `h1`.
 *
 * **Une seule ligne sur écran large.** Sa taille suit la largeur disponible
 * (unités de conteneur, `cqi`) pour tenir sur une ligne quelle que soit la
 * fenêtre, sans jamais dépasser la taille de la maquette. Le facteur est
 * calibré pour un titre d'environ soixante caractères — celui du contenu ;
 * `content-contract.md` le dit. En dessous de `lg`, il se replie normalement :
 * sur téléphone, une ligne serait illisible.
 */
import {getTranslations} from 'next-intl/server';
import {PHOTO_CSS_HEIGHT, PHOTO_CSS_WIDTH, photoSrcSet} from '@/app/api/photo/sizes';
import type {DisplayProjection} from '@/content';
import {joinParts} from './format';

export type IdentityHeadingProps = {
  readonly identite: DisplayProjection['identite'];
};

export async function IdentityHeading({identite}: IdentityHeadingProps) {
  const t = await getTranslations('identity');
  const name = joinParts([identite.prenom, identite.nom], ' ') ?? '';

  return (
    <div className="flex flex-wrap items-start gap-6">
      {identite.photo ? (
        // `next/image` n'apporterait rien ici : la photo vient d'une route qui
        // lit CONTENT_DIR et la sert déjà découpée au cadre, à chaque densité
        // (`srcset`). Le VPS n'a pas à faire tourner un optimiseur générique
        // pour une seule image. Le cadre CSS est celui de `sizes.ts`, en style
        // plutôt qu'en classe : une seule source pour les deux.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/api/photo"
          srcSet={photoSrcSet()}
          alt={t('photoAlt', {name})}
          width={PHOTO_CSS_WIDTH}
          height={PHOTO_CSS_HEIGHT}
          style={{width: PHOTO_CSS_WIDTH, height: PHOTO_CSS_HEIGHT}}
          className="shrink-0 rounded-[3px] object-cover"
        />
      ) : null}
      {/* `@container` : la taille du titre se calcule sur la largeur de cette
          colonne, pas sur celle de la fenêtre — la photo et les marges en sont
          déjà retranchées. Sous `lg`, la colonne prend toute la largeur et le
          titre passe sous la photo : à côté d'elle, il se couperait au milieu
          d'un mot. `min-w-0` : un mot trop long ne pousse pas la photo hors
          du cadre. */}
      <div className="@container w-full min-w-0 lg:w-auto lg:flex-1">
        <h1 className="font-serif text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-normal tracking-[-0.01em] break-words text-balance lg:text-[clamp(1.75rem,3.7cqi,3.5rem)] lg:whitespace-nowrap">
          {identite.titre}
        </h1>
        {identite.sous_titre === undefined ? null : (
          <p className="mt-2.5 text-[17px] text-ink-soft">{identite.sous_titre}</p>
        )}
      </div>
    </div>
  );
}
