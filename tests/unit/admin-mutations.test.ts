/**
 * `POST /admin/api/visiteurs/<ulid>` et `POST /admin/api/adresses/<ip>` — les
 * deux mutations de l'admin (story 8), et leur mécanique commune
 * (`mutation-route.ts`). Le journal est simulé : ce qui est prouvé ici, c'est
 * ce que la route **refuse** avant d'écrire — méthode, type de contenu,
 * origine, bornes, texte mal formé, `from` hors admin, cible inconnue — et ce
 * qu'elle demande au journal quand tout est en ordre. La preuve sur la base
 * réelle, contre l'artefact de production, est celle de `tests/e2e/admin.spec.ts`.
 */
import {NextRequest} from 'next/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  BODY_MAX_BYTES,
  isAdminReturnPath,
  isSameOrigin,
  normalizeField,
  readForm
} from '@/app/(admin)/admin/_lib/mutation-route';

const journal = vi.hoisted(() => ({
  setVisitor: vi.fn(),
  setIpLabel: vi.fn(),
  isJournalIp: vi.fn(),
  VISITOR_NAME_MAX: 120,
  VISITOR_NOTE_MAX: 2000,
  IP_LABEL_MAX: 120
}));
vi.mock('@/journal', () => journal);

type VisitorRoute = typeof import('@/app/(admin)/admin/api/visiteurs/[id]/route');
type AddressRoute = typeof import('@/app/(admin)/admin/api/adresses/[ip]/route');
let visitorRoute: VisitorRoute;
let addressRoute: AddressRoute;

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const HOST = '127.0.0.1:3000';
const FORM = 'application/x-www-form-urlencoded';

type CallOptions = {
  readonly method?: string;
  readonly contentType?: string | null;
  readonly headers?: Record<string, string>;
  readonly body?: string | URLSearchParams;
};

/** Une requête de formulaire, même origine par défaut — ce qu'un navigateur envoie. */
function request(path: string, options: CallOptions = {}): NextRequest {
  const headers: Record<string, string> = {host: HOST, 'sec-fetch-site': 'same-origin', ...options.headers};
  const contentType = options.contentType === undefined ? FORM : options.contentType;
  if (contentType !== null) headers['content-type'] = contentType;
  const body = options.body instanceof URLSearchParams ? options.body.toString() : (options.body ?? '');
  return new NextRequest(`http://${HOST}${path}`, {method: options.method ?? 'POST', headers, body});
}

const nommer = (id: string, fields: Record<string, string>, options: CallOptions = {}) =>
  visitorRoute.POST(request(`/admin/api/visiteurs/${id}`, {...options, body: new URLSearchParams(fields)}), {
    params: Promise.resolve({id})
  });

/** Le segment tel que Next le fournit : **déjà décodé**, même pour une IPv6 encodée dans l'URL. */
const etiqueter = (ip: string, fields: Record<string, string>, options: CallOptions = {}) =>
  addressRoute.POST(
    request(`/admin/api/adresses/${encodeURIComponent(ip)}`, {...options, body: new URLSearchParams(fields)}),
    {params: Promise.resolve({ip})}
  );

/** Recharge les routes — et `@/env`, lu à l'appel — avec la porte ouverte ou fermée. */
async function chargerLesRoutes(adminDev: '0' | '1' = '1'): Promise<void> {
  vi.stubEnv('ADMIN_DEV', adminDev);
  vi.resetModules();
  visitorRoute = await import('@/app/(admin)/admin/api/visiteurs/[id]/route');
  addressRoute = await import('@/app/(admin)/admin/api/adresses/[ip]/route');
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  journal.setVisitor.mockReturnValue(true);
  journal.isJournalIp.mockImplementation((value: string) => /^\d+\.\d+\.\d+\.\d+$/.test(value) || /^[0-9a-f:]+$/i.test(value));
  // En test, `NODE_ENV` n'est pas `production` : la porte n'est ouverte que par `ADMIN_DEV=1`.
  await chargerLesRoutes('1');
});

describe('la porte de lʼadmin (AD-10), relue par la route', () => {
  it('développement sans ADMIN_DEV → 404, corps vide, rien nʼest écrit — même origine et corps parfaits', async () => {
    await chargerLesRoutes('0');

    const response = await nommer(VISITOR_ID, {name: 'x', from: '/admin'});

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(journal.setVisitor).not.toHaveBeenCalled();
    expect((await etiqueter('203.0.113.7', {label: 'x', from: '/admin'})).status).toBe(404);
    expect(journal.setIpLabel).not.toHaveBeenCalled();
  });

  it('ADMIN_DEV=1 ouvre la porte', async () => {
    expect((await nommer(VISITOR_ID, {name: 'x', from: '/admin'})).status).toBe(303);
  });
});

describe('nommer un visiteur', () => {
  it('écrit le nom et la note normalisés, puis redirige (303) vers from', async () => {
    // Une espace de largeur nulle dans le nom, une marque dʼordre des octets dans la note :
    // construits par code, un éditeur ne les montrerait pas.
    const response = await nommer(VISITOR_ID, {
      name: `  Recruteuse fictive${String.fromCharCode(0x200b)} `,
      note: `Ligne 1\r\nLigne 2${String.fromCharCode(0xfeff)} `,
      from: '/admin/sessions/01K4EXAMPSESS0000000000000'
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/sessions/01K4EXAMPSESS0000000000000');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(journal.setVisitor).toHaveBeenCalledWith({id: VISITOR_ID, name: 'Recruteuse fictive', note: 'Ligne 1\nLigne 2'});
  });

  it('un champ absent ou vide retire : chaîne vide écrite, jamais rien de supprimé', async () => {
    const response = await nommer(VISITOR_ID, {from: '/admin'});

    expect(response.status).toBe(303);
    expect(journal.setVisitor).toHaveBeenCalledWith({id: VISITOR_ID, name: '', note: ''});
  });

  it('sans from, revient au tableau de bord', async () => {
    const response = await nommer(VISITOR_ID, {name: 'x'});
    expect(response.headers.get('location')).toBe('/admin');
  });

  it('visiteur inconnu → 404, rien dʼautre nʼest écrit', async () => {
    journal.setVisitor.mockReturnValue(false);
    expect((await nommer(VISITOR_ID, {name: 'x', from: '/admin'})).status).toBe(404);
  });

  it('identifiant qui nʼest pas un ULID → 404, sans même appeler le journal', async () => {
    for (const id of ['x', 'pas-un-ulid', '01K4EXAMPVSTR000000000000', "1' OR 1=1"]) {
      expect((await nommer(id, {name: 'x', from: '/admin'})).status, id).toBe(404);
    }
    expect(journal.setVisitor).not.toHaveBeenCalled();
  });

  it.each([
    ['nom trop long', {name: 'a'.repeat(121)}],
    ['note trop longue', {note: 'a'.repeat(2001)}]
  ])('%s → 400, rien nʼest écrit', async (_cas, fields) => {
    const response = await nommer(VISITOR_ID, {...fields, from: '/admin'});

    expect(response.status).toBe(400);
    expect(journal.setVisitor).not.toHaveBeenCalled();
  });

  it('un texte mal formé ne peut pas arriver par un formulaire : le décodage le remplace, et la route écrit un texte bien formé', async () => {
    // `%ED%A0%BD` est l'encodage d'une moitié de paire de substitution : le
    // décodage `x-www-form-urlencoded` en fait U+FFFD. Le contrôle
    // `isWellFormed()` de `normalizeField` reste la ceinture, éprouvée plus bas.
    const response = await visitorRoute.POST(
      request(`/admin/api/visiteurs/${VISITOR_ID}`, {body: 'name=%ED%A0%BD&from=%2Fadmin'}),
      {params: Promise.resolve({id: VISITOR_ID})}
    );

    expect(response.status).toBe(303);
    const {name} = journal.setVisitor.mock.calls[0]![0] as {name: string};
    expect(name.isWellFormed()).toBe(true);
    // Un caractère de remplacement par octet invalide : rien d'une paire coupée ne subsiste.
    expect(name).toBe(String.fromCharCode(0xfffd).repeat(3));
  });

  it('les bornes sont celles du journal, à la limite exacte', async () => {
    expect((await nommer(VISITOR_ID, {name: 'a'.repeat(120), note: 'b'.repeat(2000), from: '/admin'})).status).toBe(303);
  });

  it.each([
    '/fr',
    '/admin-bis',
    '/adminx',
    'https://exemple.invalid/admin',
    '//exemple.invalid/admin',
    '/admin/x y',
    '/admin/\\evil',
    '/admin/../fr',
    '/admin/./x',
    '/admin/sessions/..',
    `/admin/x${String.fromCharCode(0)}y`,
    '/admin/x\ny',
    '/admin/é',
    ''
  ])('from « %s » hors de lʼadmin → 400, rien nʼest écrit', async (from) => {
    const response = await nommer(VISITOR_ID, {name: 'x', from});

    expect(response.status).toBe(400);
    expect(journal.setVisitor).not.toHaveBeenCalled();
  });

  it.each(['/admin', '/admin/', '/admin?tout=1&page=2', '/admin?page=2', '/admin/sessions/x', '/admin/?tout=1', '/admin/visiteurs/x'])(
    'from « %s » est accepté tel quel',
    async (from) => {
      const response = await nommer(VISITOR_ID, {name: 'x', from});
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(from);
    }
  );

  it('accepte une note de 2 000 caractères à trois octets : la borne du corps est en octets, pas en caractères', async () => {
    // U+4E2D, trois octets en UTF-8, neuf une fois percent-encodé : 18 000 octets de corps.
    const note = String.fromCharCode(0x4e2d).repeat(2000);

    const response = await nommer(VISITOR_ID, {name: 'x', note, from: '/admin'});

    expect(response.status).toBe(303);
    expect(journal.setVisitor).toHaveBeenCalledWith({id: VISITOR_ID, name: 'x', note});
  });
});

describe('lʼorigine, la méthode, le type de contenu — 403 sans rien écrire', () => {
  it('Sec-Fetch-Site: same-origin passe', async () => {
    expect((await nommer(VISITOR_ID, {from: '/admin'}, {headers: {'sec-fetch-site': 'same-origin'}})).status).toBe(303);
  });

  it.each(['cross-site', 'same-site', 'none', ''])('Sec-Fetch-Site: « %s » → 403', async (value) => {
    const response = await nommer(VISITOR_ID, {name: 'x', from: '/admin'}, {headers: {'sec-fetch-site': value}});

    expect(response.status).toBe(403);
    expect(journal.setVisitor).not.toHaveBeenCalled();
  });

  it('sans Sec-Fetch-Site, Origin égal à lʼhôte de la requête passe', async () => {
    const request = new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
      method: 'POST',
      headers: {host: HOST, origin: `http://${HOST}`, 'content-type': FORM},
      body: 'name=x&from=%2Fadmin'
    });
    expect((await visitorRoute.POST(request, {params: Promise.resolve({id: VISITOR_ID})})).status).toBe(303);
  });

  it.each([`http://evil.invalid`, `http://${HOST}.evil.invalid`, 'null', 'pas une url'])(
    'sans Sec-Fetch-Site, Origin « %s » → 403',
    async (origin) => {
      const request = new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
        method: 'POST',
        headers: {host: HOST, origin, 'content-type': FORM},
        body: 'name=x&from=%2Fadmin'
      });
      expect((await visitorRoute.POST(request, {params: Promise.resolve({id: VISITOR_ID})})).status).toBe(403);
      expect(journal.setVisitor).not.toHaveBeenCalled();
    }
  );

  it('sans Sec-Fetch-Site ni Origin (curl) → 403', async () => {
    const request = new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
      method: 'POST',
      headers: {host: HOST, 'content-type': FORM},
      body: 'name=x&from=%2Fadmin'
    });
    expect((await visitorRoute.POST(request, {params: Promise.resolve({id: VISITOR_ID})})).status).toBe(403);
  });

  it.each(['application/json', 'text/plain', 'multipart/form-data; boundary=x', null])(
    'type de contenu « %s » → 415',
    async (contentType) => {
      const response = await nommer(VISITOR_ID, {name: 'x', from: '/admin'}, {contentType});

      expect(response.status).toBe(415);
      expect(journal.setVisitor).not.toHaveBeenCalled();
    }
  );

  it('le type de contenu admet un paramètre charset', async () => {
    expect(
      (await nommer(VISITOR_ID, {name: 'x', from: '/admin'}, {contentType: 'application/x-www-form-urlencoded; charset=UTF-8'}))
        .status
    ).toBe(303);
  });

  it('une autre méthode que POST → 405 avec Allow: POST (et la route nʼexporte que POST)', async () => {
    const response = await visitorRoute.POST(
      new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
        method: 'PUT',
        headers: {host: HOST, 'sec-fetch-site': 'same-origin', 'content-type': FORM},
        body: 'name=x'
      }),
      {params: Promise.resolve({id: VISITOR_ID})}
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(journal.setVisitor).not.toHaveBeenCalled();
    expect(Object.keys(visitorRoute).filter((key) => /^[A-Z]+$/.test(key))).toEqual(['POST']);
    expect(Object.keys(addressRoute).filter((key) => /^[A-Z]+$/.test(key))).toEqual(['POST']);
  });

  it('403 est réservé à lʼorigine : méthode et type passent avant, un corps invalide vient après', async () => {
    // Mauvaise méthode ET origine étrangère : 405 d'abord.
    const put = await visitorRoute.POST(
      new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
        method: 'PUT',
        headers: {host: HOST, 'sec-fetch-site': 'cross-site', 'content-type': FORM},
        body: 'name=x'
      }),
      {params: Promise.resolve({id: VISITOR_ID})}
    );
    expect(put.status).toBe(405);
    // Origine étrangère ET corps trop long : 403, le corps n'est pas lu.
    const etranger = await nommer(VISITOR_ID, {note: 'a'.repeat(BODY_MAX_BYTES + 1)}, {headers: {'sec-fetch-site': 'cross-site'}});
    expect(etranger.status).toBe(403);
  });

  it('un corps au-delà de la borne (Content-Length connu) → 400, rien nʼest écrit', async () => {
    expect(BODY_MAX_BYTES).toBe(64 * 1024);
    const response = await nommer(VISITOR_ID, {note: 'a'.repeat(BODY_MAX_BYTES + 1), from: '/admin'});

    expect(response.status).toBe(400);
    expect(journal.setVisitor).not.toHaveBeenCalled();
  });

  it('un corps en flux sans Content-Length est lu par morceaux et abandonné dès la borne franchie', async () => {
    // Un flux de morceaux de 8 Kio : le lecteur doit s'arrêter avant d'avoir tout tiré.
    let tires = 0;
    const morceau = new TextEncoder().encode('a'.repeat(8 * 1024));
    const flux = new ReadableStream<Uint8Array>({
      pull(controller) {
        tires += 1;
        if (tires > 1000) controller.close();
        else controller.enqueue(morceau);
      }
    });
    const request = new NextRequest(`http://${HOST}/admin/api/visiteurs/${VISITOR_ID}`, {
      method: 'POST',
      headers: {host: HOST, 'sec-fetch-site': 'same-origin', 'content-type': FORM},
      body: flux,
      // `duplex` est requis par undici pour un corps en flux.
      duplex: 'half'
    });
    expect(request.headers.get('content-length')).toBeNull();

    expect(await readForm(request)).toBeNull();
    // Neuf morceaux franchissent 64 Kio : lus, plus un éventuel d'avance — jamais les mille.
    expect(tires).toBeLessThanOrEqual(12);

    // Le même lecteur, sur un corps qui tient : le formulaire entier.
    const court = new NextRequest(`http://${HOST}/x`, {
      method: 'POST',
      headers: {'content-type': FORM},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('name=a'));
          controller.enqueue(new TextEncoder().encode('b&from=%2Fadmin'));
          controller.close();
        }
      }),
      duplex: 'half'
    });
    const form = await readForm(court);
    expect(form?.get('name')).toBe('ab');
    expect(form?.get('from')).toBe('/admin');
  });
});

describe('étiqueter une adresse', () => {
  it('écrit lʼétiquette normalisée sur lʼadresse du segment, puis redirige', async () => {
    const response = await etiqueter('203.0.113.7', {label: ' Bureau fictif ', from: '/admin/sessions/x'});

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/sessions/x');
    expect(journal.setIpLabel).toHaveBeenCalledWith({ip: '203.0.113.7', label: 'Bureau fictif'});
  });

  it('une IPv6, telle que Next fournit le segment (déjà décodé), est vérifiée et écrite telle quelle', async () => {
    const response = await etiqueter('2001:db8::1', {label: 'IPv6 fictive', from: '/admin'});

    expect(response.status).toBe(303);
    expect(journal.isJournalIp).toHaveBeenCalledWith('2001:db8::1');
    expect(journal.setIpLabel).toHaveBeenCalledWith({ip: '2001:db8::1', label: 'IPv6 fictive'});
  });

  it('tolère un segment encodé, que Next ne fournit pas', async () => {
    const response = await addressRoute.POST(
      request('/admin/api/adresses/2001%3Adb8%3A%3A1', {body: new URLSearchParams({label: 'x', from: '/admin'})}),
      {params: Promise.resolve({ip: '2001%3Adb8%3A%3A1'})}
    );
    expect(response.status).toBe(303);
    expect(journal.setIpLabel).toHaveBeenCalledWith({ip: '2001:db8::1', label: 'x'});
  });

  it('une étiquette vide retire', async () => {
    expect((await etiqueter('203.0.113.7', {from: '/admin'})).status).toBe(303);
    expect(journal.setIpLabel).toHaveBeenCalledWith({ip: '203.0.113.7', label: ''});
  });

  it.each(['localhost', '203.0.113', "1' OR 1=1", 'exemple.invalid'])('adresse invalide « %s » → 400, rien nʼest écrit', async (ip) => {
    const response = await etiqueter(ip, {label: 'x', from: '/admin'});

    expect(response.status).toBe(400);
    expect(journal.setIpLabel).not.toHaveBeenCalled();
  });

  it('étiquette trop longue → 400 ; origine étrangère → 403 ; dans les deux cas rien nʼest écrit', async () => {
    expect((await etiqueter('203.0.113.7', {label: 'a'.repeat(121), from: '/admin'})).status).toBe(400);
    expect(
      (await etiqueter('203.0.113.7', {label: 'x', from: '/admin'}, {headers: {'sec-fetch-site': 'cross-site'}})).status
    ).toBe(403);
    expect(journal.setIpLabel).not.toHaveBeenCalled();
  });
});

describe('la mécanique, pièce par pièce', () => {
  it('normalizeField : invisibles retirés, fins de ligne ramenées, bouts ôtés, bornes, texte bien formé', () => {
    expect(normalizeField(null, 10)).toBe('');
    expect(normalizeField('  ', 10)).toBe('');
    // Espace de largeur nulle, trait d'union conditionnel, marque d'ordre des octets.
    expect(
      normalizeField(`${String.fromCharCode(0x200b)} a${String.fromCharCode(0xad)}b${String.fromCharCode(0xfeff)} `, 10)
    ).toBe('ab');
    // Les contrôles bidirectionnels, qui retourneraient un texte à l'écran.
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(normalizeField(`a${String.fromCharCode(code)}b`, 10), code.toString(16)).toBe('ab');
    }
    expect(normalizeField('a\r\nb\rc\nd', 10)).toBe('a\nb\nc\nd');
    expect(normalizeField('a\tb', 10)).toBe('a\tb');
    expect(normalizeField(`a${String.fromCharCode(0)}b${String.fromCharCode(0x1b)}c`, 10)).toBe('abc');
    expect(normalizeField('a'.repeat(10), 10)).toBe('a'.repeat(10));
    expect(normalizeField('a'.repeat(11), 10)).toBeNull();
    expect(normalizeField(String.fromCharCode(0xd83d), 10)).toBeNull();
    // Un emoji entier est bien formé et compte deux unités.
    const emoji = String.fromCodePoint(0x1f600);
    expect(normalizeField(emoji, 2)).toBe(emoji);
  });

  it('normalizeField garde les liants et antiliants : un emoji composé, un mot persan', () => {
    // Famille : homme + ZWJ + femme + ZWJ + fille — le liant (U+200D) fait l'emoji.
    const zwj = String.fromCharCode(0x200d);
    const famille = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(zwj);
    expect(normalizeField(famille, 20)).toBe(famille);
    // « می‌خواهم » : l'antiliant (U+200C) sépare « می » de « خواهم » sans espace.
    const zwnj = String.fromCharCode(0x200c);
    const persan = String.fromCharCode(0x645, 0x6cc) + zwnj + String.fromCharCode(0x62e, 0x648, 0x627, 0x647, 0x645);
    expect(normalizeField(persan, 20)).toBe(persan);
    expect(normalizeField(persan, 20)).toContain(zwnj);
  });

  it('isAdminReturnPath : /admin, /admin?…, /admin/… en ASCII imprimable, sans . ni .. — rien dʼautre', () => {
    for (const ok of ['/admin', '/admin/', '/admin?page=2', '/admin?tout=1&page=2', '/admin/sessions/x', '/admin/?page=2', '/admin/a.b', '/admin/x..y']) {
      expect(isAdminReturnPath(ok), ok).toBe(true);
    }
    for (const ko of [
      '/',
      '/fr',
      '/admin-bis',
      '/adminx',
      'admin',
      '//admin',
      'https://x/admin',
      '/admin/a b',
      '/admin\nx',
      '/admin/x\ny',
      '/admin\\x',
      '/admin/\\x',
      `/admin/${String.fromCharCode(0)}`,
      '/admin/é',
      `/admin/${String.fromCharCode(0x7f)}`,
      '/admin/..',
      '/admin/../fr',
      '/admin/.',
      '/admin/./x',
      '/admin/x/../y',
      '/admin?../x/../../fr'.replace('?', '/')
    ]) {
      expect(isAdminReturnPath(ko), JSON.stringify(ko)).toBe(false);
    }
  });

  it('isSameOrigin : Sec-Fetch-Site fait foi, Origin à défaut, rien sinon', () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    expect(isSameOrigin(h({'sec-fetch-site': 'same-origin', origin: 'http://evil.invalid', host: HOST}))).toBe(true);
    expect(isSameOrigin(h({'sec-fetch-site': 'cross-site', origin: `http://${HOST}`, host: HOST}))).toBe(false);
    expect(isSameOrigin(h({origin: `http://${HOST}`, host: HOST}))).toBe(true);
    expect(isSameOrigin(h({origin: `https://${HOST}`, host: HOST}))).toBe(true);
    expect(isSameOrigin(h({origin: 'http://evil.invalid', host: HOST}))).toBe(false);
    expect(isSameOrigin(h({origin: `http://${HOST}`}))).toBe(false);
    expect(isSameOrigin(h({host: HOST}))).toBe(false);
    expect(isSameOrigin(h({}))).toBe(false);
  });
});
