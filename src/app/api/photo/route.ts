/**
 * La photo, servie depuis `CONTENT_DIR/assets/` — AD-8.
 *
 * `displayProjection` n'annonce que la **présence** d'une photo ; son chemin ne
 * sort jamais de la couche `content`. Cette route est la contrepartie de ce
 * silence : une adresse fixe, dont le seul paramètre est la densité d'écran
 * (`?s=1|2|3`, voir `sizes.ts`), qui rend le seul fichier déclaré par
 * `identite.photo`. Il n'y a donc aucun chemin à valider et rien à traverser —
 * le visiteur ne choisit pas ce qu'il lit, seulement à quelle taille.
 *
 * **Servie découpée, jamais telle quelle.** Une image matricielle est réduite
 * au cadre affiché par la page — un portrait 3:4 — à la densité demandée. Trois
 * raisons :
 *  - la netteté : réduire 600 px en 104 px est un travail que les navigateurs
 *    font mal, et que `sharp` fait bien, une fois ;
 *  - les métadonnées : l'original porte de l'EXIF (logiciel, date de prise de
 *    vue…) ; le redimensionnement le retire, la page n'a pas à le publier ;
 *  - le poids : 340 Ko pour un cadre de 104 px de large, c'était trente fois trop.
 * Un SVG est vectoriel : il est servi tel quel, quelle que soit la densité.
 * Si le redimensionnement échoue — fichier corrompu, format que `sharp` ne lit
 * pas — la route répond `404` et journalise : servir l'original « en secours »
 * publierait ses métadonnées, précisément ce qu'on vient de dire ne pas faire.
 * L'échec n'est pas mis en cache, un défaut passager se retente à la requête
 * suivante.
 *
 * Trois précautions sur la réponse :
 *  - `private` : la photo est une donnée personnelle, aucun cache partagé ne la
 *    retient ;
 *  - `no-cache` + `ETag` (propre à chaque variante) : le navigateur revalide à
 *    chaque visite et reçoit un `304` tant que le fichier n'a pas bougé — le
 *    contenu est gelé au démarrage, mais un redémarrage doit suffire à publier
 *    une nouvelle photo ;
 *  - `nosniff` et une CSP muette : `cv.yaml` accepte une photo en SVG, et un SVG
 *    servi depuis l'origine du site pourrait exécuter du script si on l'ouvrait
 *    directement. `sandbox` le neutralise sans gêner le rendu dans `<img>`.
 */
import sharp from 'sharp';
import type {ServedPhoto} from '@/content';
import {PHOTO_CSS_HEIGHT, PHOTO_CSS_WIDTH, photoScale, type PhotoScale} from './sizes';

/**
 * Jamais rendue au build : elle lit `CONTENT_DIR`, qui n'existe qu'à l'exécution.
 *
 * `force-dynamic` ne suffit pas : Next **charge** quand même le module pour en
 * lire les exports (« Collecting page data »), et un `import` statique de
 * `@/content` entraînerait `@/env`, dont le parsage Zod a lieu au chargement.
 * Le build réclamerait alors une clé API et un chemin de contenu — exactement ce
 * que `next.config.ts` refuse. D'où un import dynamique **dans** la fonction :
 * son spécifieur reste un littéral, donc analysable par
 * `tests/unit/layers.test.ts`, mais il n'est évalué qu'à la requête.
 */
export const dynamic = 'force-dynamic';

const CACHE_CONTROL = 'private, no-cache';
const SAFETY = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
};

/** Ce que `sharp` sait réduire ; tout le reste est servi tel quel. */
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

type Variant = {readonly bytes: Uint8Array<ArrayBuffer>; readonly etag: string};

/**
 * Les variantes déjà calculées, par `ETag` d'origine et densité. La photo est
 * lue une fois au démarrage (AD-2) : trois calculs par processus, jamais plus.
 * La clé porte l'`ETag` par prudence — un contenu rechargé sous un autre
 * condensé ne peut pas hériter d'une variante calculée sur l'ancien.
 */
const variants = new Map<string, Promise<Variant | null>>();
let variantsOf: string | undefined;

/**
 * `If-None-Match` selon RFC 9110 : une liste de validateurs, éventuellement
 * faibles (`W/"…"`, ce qu'un intermédiaire qui compresse peut produire), ou
 * `*`. Une comparaison stricte à un seul validateur fort ne répondrait jamais
 * `304` derrière un tel intermédiaire.
 */
function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}

function variantEtag(etag: string, scale: PhotoScale): string {
  // `"4-18f2c"` devient `"4-18f2c-s2"` : un validateur par variante, sinon un
  // navigateur passé de 1× à 2× recevrait un `304` pour la mauvaise taille.
  return etag.endsWith('"') ? `${etag.slice(0, -1)}-s${scale}"` : `${etag}-s${scale}`;
}

async function resize(image: ServedPhoto, scale: PhotoScale): Promise<Variant | null> {
  const width = PHOTO_CSS_WIDTH * scale;
  const height = PHOTO_CSS_HEIGHT * scale;
  try {
    // `rotate()` sans argument applique l'orientation EXIF avant que le
    // redimensionnement ne la retire ; le format de sortie reste celui
    // d'entrée. Un GIF animé ne garde que sa première image : une photo de CV
    // n'a pas à bouger.
    const bytes = await sharp(image.bytes)
      .rotate()
      .resize(width, height, {fit: 'cover', position: 'centre'})
      .toBuffer();
    // `sharp` rend un `Buffer`, dont le `ArrayBuffer` peut être partagé ; la
    // copie donne le `Uint8Array<ArrayBuffer>` propre que `Response` exige.
    return {bytes: new Uint8Array(bytes), etag: variantEtag(image.etag, scale)};
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'photo.resize_failed',
        scale,
        reason: error instanceof Error ? error.message : String(error)
      })
    );
    return null;
  }
}

function variant(image: ServedPhoto, scale: PhotoScale): Promise<Variant | null> {
  if (!RASTER.has(image.mime)) {
    return Promise.resolve({bytes: image.bytes, etag: image.etag});
  }
  if (variantsOf !== image.etag) {
    variants.clear();
    variantsOf = image.etag;
  }
  const key = `${image.etag}:${scale}`;
  let pending = variants.get(key);
  if (pending === undefined) {
    pending = resize(image, scale).then((result) => {
      // Un échec ne se mémorise pas : la prochaine requête réessaie.
      if (result === null) variants.delete(key);
      return result;
    });
    variants.set(key, pending);
  }
  return pending;
}

export async function GET(request: Request): Promise<Response> {
  const scale = photoScale(new URL(request.url).searchParams.get('s'));
  if (scale === undefined) {
    return new Response(null, {status: 400, headers: {'Cache-Control': CACHE_CONTROL}});
  }

  const {photo} = await import('@/content');
  const image = photo();
  // Champ absent de `cv.yaml`, fichier introuvable ou illisible au démarrage,
  // type non reconnu : la page se rend sans photo, et cette route le dit.
  if (image === null) {
    return new Response(null, {status: 404, headers: {'Cache-Control': CACHE_CONTROL}});
  }

  const served = await variant(image, scale);
  if (served === null) {
    return new Response(null, {status: 404, headers: {'Cache-Control': CACHE_CONTROL}});
  }
  const {bytes, etag} = served;

  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, {
      status: 304,
      headers: {'Cache-Control': CACHE_CONTROL, ETag: etag}
    });
  }

  return new Response(bytes, {
    headers: {
      ...SAFETY,
      'Content-Type': image.mime,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': CACHE_CONTROL,
      ETag: etag
    }
  });
}
