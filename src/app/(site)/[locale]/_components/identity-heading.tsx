/**
 * Le titre — la première chose lue, sur toute la largeur.
 *
 * Mise en page validée par Jérémie le 2026-09-15, retouchée le 2026-09-17 :
 * la photo à gauche, le titre qui court sur toute la largeur du premier écran,
 * le sous-titre dessous. Le titre porte le positionnement (`CAP-1`), il est
 * donc le `h1`. Le nom, lui, vit dans la barre (`SiteHeader`), **à la même
 * taille** que le titre : `HEADLINE` est la source unique des deux.
 *
 * **Une seule ligne sur écran large.** Sa taille suit la largeur de la fenêtre
 * (`vw`, et non la largeur du conteneur : le nom, dans la barre, doit obtenir
 * exactement la même taille depuis un autre conteneur) pour tenir sur une
 * ligne quelle que soit la fenêtre, plafonnée à trente pixels — plus sobre que
 * la maquette, à la demande de Jérémie. Le facteur est calibré pour un titre
 * d'environ soixante caractères dans la colonne à côté de la photo — celui du
 * contenu ; `content-contract.md` le dit. La même formule vaut à toute largeur
 * — pas de saut au point de rupture — ; en dessous de `lg`, il se replie
 * normalement : sur téléphone, une ligne serait illisible.
 */
import {getTranslations} from 'next-intl/server';
import {PHOTO_CSS_HEIGHT, PHOTO_CSS_WIDTH, photoSrcSet} from '@/app/api/photo/sizes';
import type {DisplayProjection} from '@/content';
import {joinParts} from './format';

export type IdentityHeadingProps = {
  readonly identite: DisplayProjection['identite'];
};

/** La même taille pour le nom (barre) et le titre (premier écran) : une seule source. */
export const HEADLINE =
  'font-serif text-[clamp(1.5rem,2.4vw,1.875rem)] leading-[1.15] font-normal tracking-[-0.01em] break-words';

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
      {/* Sous `lg`, la colonne prend toute la largeur et le titre passe sous la
          photo : à côté d'elle, il se couperait au milieu d'un mot. `min-w-0` :
          un mot trop long ne pousse pas la photo hors du cadre. */}
      <div className="w-full min-w-0 lg:w-auto lg:flex-1">
        <h1 className={`${HEADLINE} text-balance lg:whitespace-nowrap`}>
          {identite.titre}
        </h1>
        {identite.sous_titre === undefined ? null : (
          <p className="mt-2.5 text-[17px] text-ink-soft">{identite.sous_titre}</p>
        )}
      </div>
    </div>
  );
}
