/**
 * Les tailles auxquelles la photo est servie — sans `sharp`, pour que la page
 * puisse importer ce module sans embarquer l'outil de redimensionnement.
 *
 * La photo n'est affichée qu'à **une** taille : le carré de 104 px CSS de
 * `identity-block.tsx` (`h-26 w-26`). Servir l'original de 600 px pour ce
 * carré obligeait le navigateur à le réduire de près de six fois, et Chrome le
 * fait mal sur un tel rapport : Jérémie voyait sa photo « pixelisée ». La route
 * sert donc le carré déjà découpé, à 1×, 2× et 3× la taille CSS, et la page
 * les déclare en `srcset` — chaque écran reçoit sa densité, rien de plus.
 */
export const PHOTO_CSS_SIZE = 104;

export const PHOTO_SCALES = [1, 2, 3] as const;
export type PhotoScale = (typeof PHOTO_SCALES)[number];

/** Ce que reçoit un navigateur qui demande `/api/photo` sans préciser. */
export const DEFAULT_SCALE: PhotoScale = 2;

/**
 * Interprète le paramètre `s` de la route. Absent : la valeur par défaut ;
 * hors de la liste : `undefined`, et la route répond `400` plutôt que de
 * deviner — l'adresse n'a que trois formes légitimes, toutes écrites ici.
 */
export function photoScale(value: string | null): PhotoScale | undefined {
  if (value === null) return DEFAULT_SCALE;
  // Un seul chiffre, sans espace ni signe : `Number(' 2')` vaudrait 2.
  if (!/^\d$/.test(value)) return undefined;
  const parsed = Number(value);
  return PHOTO_SCALES.find((scale) => scale === parsed);
}

/** L'attribut `srcset` de la page : une variante par densité d'écran. */
export function photoSrcSet(): string {
  return PHOTO_SCALES.map((scale) => `/api/photo?s=${scale} ${scale}x`).join(', ');
}
