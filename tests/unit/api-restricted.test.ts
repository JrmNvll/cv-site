/**
 * Les deux routes qui servent ce qu'aucune projection ne porte — AD-8.
 *
 * Elles sont la contrepartie assumée du silence des projections : la photo et le
 * téléphone existent dans `cv.yaml`, n'en sortent par aucune projection, et ne
 * s'obtiennent que par une adresse nommée. Ce qui doit être prouvé n'est donc
 * pas seulement qu'elles répondent, mais **comment elles répondent quand il n'y
 * a rien** — un champ absent de `cv.yaml`, un fichier disparu depuis le
 * démarrage — puisque c'est le cas que la matrice de la story décrit et que la
 * fixture, elle, ne peut pas produire : Playwright ne sert qu'un seul contenu.
 *
 * La couche `content` est donc simulée. C'est le seul moyen d'atteindre les
 * branches « absent » sans fabriquer un second serveur.
 */
import {NextRequest} from 'next/server';
import sharp from 'sharp';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  PHOTO_CSS_HEIGHT,
  PHOTO_CSS_WIDTH,
  PHOTO_SCALES,
  photoScale,
  photoSrcSet
} from '@/app/api/photo/sizes';

const contenu = vi.hoisted(() => ({
  photo: vi.fn(),
  contactPhone: vi.fn(),
  referenceContact: vi.fn()
}));
// Le journal aussi : la route du téléphone prolonge la session (AD-14), et ce
// qui est prouvé ici, c'est qu'elle ne le fait qu'avec des cookies.
const journal = vi.hoisted(() => ({touchSession: vi.fn()}));

vi.mock('@/content', () => contenu);
vi.mock('@/journal', () => journal);

type Route = typeof import('@/app/api/photo/route');
let photoRoute: Route;
let getPhoto: Route['GET'];
const {GET: getPhone, dynamic: dynamiquePhone} = await import('@/app/api/contact/phone/route');
const {GET: getReference, dynamic: dynamiqueReference} = await import(
  '@/app/api/references/[id]/contact/route'
);

/** Un appel à la route des coordonnées d'une référence, avec ou sans cookies. */
function appelReference(id: string, cookie?: string) {
  const request = new NextRequest(`http://127.0.0.1:3000/api/references/${id}/contact`, {
    headers: cookie
      ? {cookie, host: '127.0.0.1:3000', referer: 'http://127.0.0.1:3000/fr'}
      : {host: '127.0.0.1:3000'}
  });
  return getReference(request, {params: Promise.resolve({id})});
}

/** Un appel à la route du téléphone, avec ou sans cookies de visite. */
function appelTelephone(cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/contact/phone', {
    headers: cookie
      ? {cookie, host: '127.0.0.1:3000', referer: 'http://127.0.0.1:3000/en'}
      : {host: '127.0.0.1:3000'}
  });
}

/** Quatre octets d'en-tête PNG : reconnaissables, mais pas une image. */
const OCTETS = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ETAG = '"4-18f2c"';

/**
 * Une vraie photo, aux proportions de l'original (portrait 600 × 772), avec des
 * métadonnées EXIF que la route doit **retirer** : le fichier réel en porte
 * (logiciel, date de retouche), et rien de cela n'a à être publié.
 */
const PORTRAIT = new Uint8Array(
  await sharp({create: {width: 600, height: 772, channels: 3, background: '#c8844a'}})
    .jpeg()
    .withExif({IFD0: {Copyright: 'Sentinelle-EXIF-Fictive'}})
    .toBuffer()
);
const ETAG_PORTRAIT = '"9d2e-18f2d"';

function requete(headers: Record<string, string> = {}, s?: string): Request {
  const url = new URL('http://127.0.0.1:3000/api/photo');
  if (s !== undefined) url.searchParams.set('s', s);
  return new Request(url, {headers});
}

beforeEach(async () => {
  vi.resetAllMocks();
  // La route garde un cache de variantes au niveau du module : chaque test
  // repart d'un module neuf, sinon leur ordre déciderait de ce qu'ils prouvent.
  vi.resetModules();
  photoRoute = await import('@/app/api/photo/route');
  getPhoto = photoRoute.GET;
});

describe('les tailles de la photo', () => {
  it('nʼa que trois densités, et une valeur par défaut parmi elles', () => {
    expect(PHOTO_SCALES).toEqual([1, 2, 3]);
    expect(photoScale(null)).toBe(2);
    for (const scale of PHOTO_SCALES) expect(photoScale(String(scale))).toBe(scale);
    for (const refuse of ['0', '4', '2.5', 'abc', '', ' 2']) {
      expect(photoScale(refuse), `« ${refuse} » ne doit pas passer`).toBeUndefined();
    }
  });

  it('déclare une variante par densité, à la route et rien dʼautre', () => {
    expect(photoSrcSet()).toBe('/api/photo?s=1 1x, /api/photo?s=2 2x, /api/photo?s=3 3x');
  });
});

describe('GET /api/photo', () => {
  it('nʼest jamais rendue au build : les deux routes se déclarent dynamiques (AD-2)', () => {
    expect(photoRoute.dynamic).toBe('force-dynamic');
    expect(dynamiquePhone).toBe('force-dynamic');
  });

  it('sert le portrait découpé à la densité demandée, sans EXIF, dans le format dʼorigine', async () => {
    contenu.photo.mockReturnValue({bytes: PORTRAIT, mime: 'image/jpeg', etag: ETAG_PORTRAIT});

    for (const scale of PHOTO_SCALES) {
      const reponse = await getPhoto(requete({}, String(scale)));
      expect(reponse.status).toBe(200);
      expect(reponse.headers.get('content-type')).toBe('image/jpeg');
      expect(reponse.headers.get('cache-control')).toContain('private');

      const octets = new Uint8Array(await reponse.arrayBuffer());
      expect(reponse.headers.get('content-length')).toBe(String(octets.byteLength));
      const meta = await sharp(octets).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'jpeg',
        PHOTO_CSS_WIDTH * scale,
        PHOTO_CSS_HEIGHT * scale
      ]);
      expect(meta.exif).toBeUndefined();
      expect(Buffer.from(octets).includes('Sentinelle-EXIF-Fictive')).toBe(false);
    }
  });

  it('sert la densité 2× quand rien nʼest précisé, et refuse toute autre valeur', async () => {
    contenu.photo.mockReturnValue({bytes: PORTRAIT, mime: 'image/jpeg', etag: ETAG_PORTRAIT});

    const meta = await sharp(new Uint8Array(await (await getPhoto(requete())).arrayBuffer())).metadata();
    expect(meta.width).toBe(PHOTO_CSS_WIDTH * 2);

    for (const refuse of ['0', '4', 'abc']) {
      const reponse = await getPhoto(requete({}, refuse));
      expect(reponse.status, `s=${refuse}`).toBe(400);
      expect(reponse.headers.get('cache-control')).toContain('private');
    }
    // Rien n'a été lu : une adresse illégitime ne coûte pas un accès au contenu.
    expect(contenu.photo).toHaveBeenCalledTimes(1);
  });

  it('donne à chaque variante son propre ETag, et honore le 304 par variante', async () => {
    contenu.photo.mockReturnValue({bytes: PORTRAIT, mime: 'image/jpeg', etag: ETAG_PORTRAIT});

    // En séquence, pas en parallèle : vitest n'applique le simulacre de
    // `@/content` qu'au premier `import()` concurrent, les suivants reçoivent le
    // vrai module. En production il n'y a pas de simulacre, donc pas de course.
    const etags: (string | null)[] = [];
    for (const scale of PHOTO_SCALES) {
      etags.push((await getPhoto(requete({}, String(scale)))).headers.get('etag'));
    }
    expect(new Set(etags).size).toBe(PHOTO_SCALES.length);
    for (const etag of etags) expect(etag).toMatch(/^".*"$/);

    // Le validateur de 2× ne vaut pas pour 1× : ce serait servir la mauvaise taille.
    const deux = etags[1]!;
    const revalide = await getPhoto(requete({'if-none-match': deux}, '2'));
    expect(revalide.status).toBe(304);
    expect(await revalide.text()).toBe('');
    expect((await getPhoto(requete({'if-none-match': deux}, '1'))).status).toBe(200);
    expect((await getPhoto(requete({'if-none-match': '"autre-version"'}, '2'))).status).toBe(200);
  });

  it('lit If-None-Match comme HTTP lʼécrit : liste, validateur faible, joker', async () => {
    contenu.photo.mockReturnValue({bytes: PORTRAIT, mime: 'image/jpeg', etag: ETAG_PORTRAIT});
    const etag = (await getPhoto(requete({}, '2'))).headers.get('etag')!;

    // Un intermédiaire qui compresse affaiblit le validateur ; un navigateur
    // peut en annoncer plusieurs ; `*` vaut pour n'importe lequel.
    for (const entete of [`W/${etag}`, `"ancien", ${etag}`, `"ancien" , W/${etag}`, '*']) {
      expect((await getPhoto(requete({'if-none-match': entete}, '2'))).status, entete).toBe(304);
    }
    expect((await getPhoto(requete({'if-none-match': '"ancien"'}, '2'))).status).toBe(200);
  });

  it('répond 404, et le dit, quand le fichier nʼest pas une image lisible — sans mémoriser lʼéchec', async () => {
    // Quatre octets d'en-tête : `sharp` échoue. L'original ne part **pas** en
    // secours — il porterait ses métadonnées — et l'échec est journalisé.
    contenu.photo.mockReturnValue({bytes: OCTETS, mime: 'image/png', etag: ETAG});
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reponse = await getPhoto(requete());

    expect(reponse.status).toBe(404);
    expect(reponse.headers.get('content-type')).toBeNull();
    expect(reponse.headers.get('cache-control')).toContain('private');
    expect(await reponse.text()).toBe('');
    expect(avertit).toHaveBeenCalledTimes(1);
    expect(avertit.mock.calls[0]![0]).toContain('photo.resize_failed');

    // Un défaut passager se retente : la deuxième requête recalcule, et le dit.
    expect((await getPhoto(requete())).status).toBe(404);
    expect(avertit).toHaveBeenCalledTimes(2);
    avertit.mockRestore();
  });

  it('neutralise un SVG servi depuis lʼorigine du site, et le sert tel quel', async () => {
    // `cv.yaml` accepte une photo en SVG ; ouvert directement, un SVG pourrait
    // exécuter du script sur l'origine du site. `sandbox` le désamorce. Et un
    // vecteur n'a pas de densité : aucune variante, l'ETag d'origine.
    contenu.photo.mockReturnValue({bytes: OCTETS, mime: 'image/svg+xml', etag: ETAG});

    const reponse = await getPhoto(requete({}, '3'));
    const entetes = reponse.headers;

    expect(entetes.get('x-content-type-options')).toBe('nosniff');
    expect(entetes.get('content-security-policy')).toContain('sandbox');
    expect(entetes.get('etag')).toBe(ETAG);
    expect(new Uint8Array(await reponse.arrayBuffer())).toEqual(OCTETS);
  });

  it('répond 404 quand il nʼy a pas de photo — champ absent, fichier illisible, type inconnu', async () => {
    contenu.photo.mockReturnValue(null);

    const reponse = await getPhoto(requete());

    expect(reponse.status).toBe(404);
    expect(reponse.headers.get('content-type')).toBeNull();
  });
});

describe('GET /api/contact/phone', () => {
  it('rend le numéro, sans aucun cache', async () => {
    contenu.contactPhone.mockReturnValue('+41 00 000 00 07');

    const reponse = await getPhone(appelTelephone());

    expect(reponse.status).toBe(200);
    // Rien du numéro ne doit rester dans un cache, fût-il privé.
    expect(reponse.headers.get('cache-control')).toContain('no-store');
    expect(await reponse.json()).toEqual({telephone: '+41 00 000 00 07'});
  });

  it('répond 404 quand `cv.yaml` nʼen déclare pas', async () => {
    contenu.contactPhone.mockReturnValue(null);

    const reponse = await getPhone(appelTelephone());

    expect(reponse.status).toBe(404);
    expect(await reponse.json()).not.toHaveProperty('telephone');
  });

  it('traite un numéro vide comme un numéro absent', async () => {
    contenu.contactPhone.mockReturnValue('');
    expect((await getPhone(appelTelephone())).status).toBe(404);
  });

  it('prolonge la session du visiteur qui présente ses cookies — un geste réel (AD-14)', async () => {
    contenu.contactPhone.mockReturnValue('+41 00 000 00 07');
    journal.touchSession.mockReturnValue({outcome: 'prolonged', visitorCreated: false});

    const reponse = await getPhone(
      appelTelephone('cv_visitor=01K4EXAMPVSTR0000000000000; cv_session=01K4EXAMPSESS0000000000000.1757930400000')
    );

    expect(reponse.status).toBe(200);
    expect(journal.touchSession).toHaveBeenCalledTimes(1);
    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        visitorId: '01K4EXAMPVSTR0000000000000',
        sessionId: '01K4EXAMPSESS0000000000000',
        // La langue vient de la page qui a émis l'appel, pas du routage.
        lang: 'en'
      })
    );
  });

  it('répond normalement sans cookies, et ne touche pas au journal', async () => {
    contenu.contactPhone.mockReturnValue('+41 00 000 00 07');

    const reponse = await getPhone(appelTelephone());

    expect(reponse.status).toBe(200);
    expect(journal.touchSession).not.toHaveBeenCalled();
  });
});

describe('GET /api/references/[id]/contact', () => {
  const COOKIES =
    'cv_visitor=01K4EXAMPVSTR0000000000000; cv_session=01K4EXAMPSESS0000000000000.1757930400000';

  it('nʼest jamais rendue au build (AD-2)', () => {
    expect(dynamiqueReference).toBe('force-dynamic');
  });

  it('rend les coordonnées de la référence, sans aucun cache', async () => {
    contenu.referenceContact.mockReturnValue({
      telephone: '+41 00 000 00 08',
      email: 'referente-fictive@exemple.invalid'
    });

    const reponse = await appelReference('reference-fictive');

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('cache-control')).toContain('no-store');
    expect(await reponse.json()).toEqual({
      telephone: '+41 00 000 00 08',
      email: 'referente-fictive@exemple.invalid'
    });
    expect(contenu.referenceContact).toHaveBeenCalledWith('reference-fictive');
  });

  it('omet une coordonnée absente plutôt que de rendre null', async () => {
    contenu.referenceContact.mockReturnValue({telephone: null, email: 'seule@exemple.invalid'});

    expect(await (await appelReference('reference-fictive')).json()).toEqual({
      email: 'seule@exemple.invalid'
    });
  });

  it('répond 404 pour une référence inconnue ou sans coordonnées', async () => {
    contenu.referenceContact.mockReturnValue(null);

    const reponse = await appelReference('inconnue');

    expect(reponse.status).toBe(404);
    expect(await reponse.json()).not.toHaveProperty('email');
  });

  it('refuse un identifiant qui nʼa pas la forme du contrat, sans rien lire ni journaliser', async () => {
    for (const id of ['../secret', 'Daniel Vallon', 'a_b', '', 'ID']) {
      expect((await appelReference(id, COOKIES)).status, `id « ${id} »`).toBe(404);
    }
    expect(contenu.referenceContact).not.toHaveBeenCalled();
    expect(journal.touchSession).not.toHaveBeenCalled();
  });

  it('prolonge la session du visiteur qui présente ses cookies — un geste réel (AD-14)', async () => {
    contenu.referenceContact.mockReturnValue({telephone: '+41 00 000 00 08', email: null});
    journal.touchSession.mockReturnValue({outcome: 'prolonged', visitorCreated: false});

    expect((await appelReference('reference-fictive', COOKIES)).status).toBe(200);
    expect(journal.touchSession).toHaveBeenCalledTimes(1);
    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({visitorId: '01K4EXAMPVSTR0000000000000', lang: 'fr'})
    );
  });
});
