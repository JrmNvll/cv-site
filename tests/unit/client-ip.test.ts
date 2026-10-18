/**
 * AD-15 — une seule source pour l'adresse du client.
 *
 * L'avertissement « en-tête absent » ne part qu'une fois par processus : le
 * drapeau vit sur `globalThis`, pas dans le module, parce que le serveur de
 * production charge le module une fois par graphe (pages, routes). Chaque cas
 * repart donc d'un « processus neuf » en effaçant ce drapeau, et un cas prouve
 * qu'une seconde copie du module ne réavertit pas.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

type ClientIpModule = typeof import('@/lib/client-ip');

/** Le drapeau que `clientIp()` pose une fois par processus. */
const REPORTED = Symbol.for('cv-site.client-ip.reported');

function processusNeuf(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[REPORTED];
}

async function loadClientIp(nodeEnv: 'production' | 'development' | 'test'): Promise<ClientIpModule> {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return import('@/lib/client-ip');
}

beforeEach(processusNeuf);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  processusNeuf();
});

describe('ipBlockKey — la clé sous laquelle une adresse se bloque (story 13)', () => {
  // La fonction ne lit pas l'environnement : un seul chargement suffit.
  const cle = async (valeur: string) => (await loadClientIp('production')).ipBlockKey(valeur);

  it.each([
    ['dev', 'hors production, aucun client derrière'],
    ['unknown', 'les sondes de santé de deploy.ps1 la portent : la bloquer fermerait le site'],
    ['', 'rien à bloquer'],
    ['pas une adresse', "ce n'est pas une adresse"],
    ['203.0.113.7.9', 'quatre octets, pas cinq']
  ])('refuse %j — %s', async (valeur) => {
    expect(await cle(valeur)).toBeNull();
  });

  it('rend une IPv4 telle quelle : elle désigne déjà un client', async () => {
    expect(await cle('203.0.113.7')).toBe('203.0.113.7');
    expect(await cle(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('rend le préfixe /64 dʼune IPv6 : cʼest le raccordement qui dure, pas lʼadresse', async () => {
    expect(await cle('2001:db8:1:2::5')).toBe('2001:db8:1:2::/64');
    // Forme longue, zéros de tête, majuscules : la même clé.
    expect(await cle('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(await cle('2001:0db8:0001:0002::5')).toBe('2001:db8:1:2::/64');
    expect(await cle('2001:DB8:1:2::5')).toBe('2001:db8:1:2::/64');
    // Une zone d'interface ne change pas le raccordement.
    expect(await cle('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('bloque ensemble les adresses dʼun même /64, et pas celles du voisin', async () => {
    const abonne = await cle('2001:db8:1:2::5');
    expect(await cle('2001:db8:1:2::9')).toBe(abonne);
    expect(await cle('2001:db8:1:2:ffff::1')).toBe(abonne);
    expect(await cle('2001:db8:1:3::5')).not.toBe(abonne);
  });

  it('ramène une IPv4 encapsulée à son IPv4 — son /64 serait nul, donc partagé par tous', async () => {
    expect(await cle('::ffff:192.0.2.1')).toBe('192.0.2.1');
    // La forme ancienne, qu'on ne verra pas venir de Caddy : traitée pareil.
    expect(await cle('::192.0.2.1')).toBe('192.0.2.1');
    // Et surtout : deux clients encapsulés ne se confondent jamais.
    expect(await cle('::ffff:192.0.2.1')).not.toBe(await cle('::ffff:198.51.100.9'));
  });

  it('bloque par son /64 une IPv6 qui finit par un quad pointé — NAT64 comprise', async () => {
    // `64:ff9b::/96` est le préfixe NAT64 bien réel : des abonnés mobiles
    // entiers passent par là. Avant la revue de la story 13, ces adresses
    // n'avaient **aucune** clé, et le formulaire affirmait à tort que
    // « l'adresse ne désigne personne ».
    expect(await cle('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    expect(await cle('2001:db8:1:2::192.0.2.1')).toBe('2001:db8:1:2::/64');
    // Deux clients du même /64 NAT64 partagent la clé, comme ailleurs.
    expect(await cle('64:ff9b::198.51.100.9')).toBe(await cle('64:ff9b::192.0.2.1'));
    // Un quad pointé hors bornes n'est pas une adresse : refusé, pas deviné.
    expect(await cle('2001:db8::999.0.2.1')).toBeNull();
  });

  it('bloque exactement les adresses à préfixe nul, jamais leur /64', async () => {
    // `::1` et `::` ont le même préfixe `/64` que toute adresse encapsulée :
    // en déduire un `/64` fermerait le site au monde entier.
    expect(await cle('::1')).toBe('0:0:0:0:0:0:0:1');
    expect(await cle('::')).toBe('0:0:0:0:0:0:0:0');
    expect(await cle('::1')).not.toContain('/64');
  });
});

describe('hors production', () => {
  it.each(['development', 'test'] as const)('rend « dev » en %s, quel que soit lʼen-tête', async (nodeEnv) => {
    const {clientIp, DEV_CLIENT_IP} = await loadClientIp(nodeEnv);

    expect(clientIp(new Headers())).toBe(DEV_CLIENT_IP);
    expect(clientIp(new Headers({'X-Client-IP': '203.0.113.7'}))).toBe(DEV_CLIENT_IP);
    expect(DEV_CLIENT_IP).toBe('dev');
  });
});

describe('en production', () => {
  it('rend X-Client-IP, posé par Caddy', async () => {
    const {clientIp} = await loadClientIp('production');

    expect(clientIp(new Headers({'X-Client-IP': '203.0.113.7'}))).toBe('203.0.113.7');
    // Insensible à la casse et aux espaces : c'est un en-tête HTTP.
    expect(clientIp(new Headers({'x-client-ip': ' 2001:db8::7 '}))).toBe('2001:db8::7');
  });

  it('rend « unknown » sans lʼen-tête, et nʼavertit quʼune fois par processus', async () => {
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {clientIp, UNKNOWN_CLIENT_IP} = await loadClientIp('production');

    expect(clientIp(new Headers())).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp(new Headers({'X-Client-IP': ''}))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp(new Headers())).toBe(UNKNOWN_CLIENT_IP);

    expect(UNKNOWN_CLIENT_IP).toBe('unknown');
    expect(avertit).toHaveBeenCalledTimes(1);
    const ligne = JSON.parse(avertit.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(ligne.level).toBe('warn');
    expect(ligne.event).toBe('client_ip.header_missing');
    expect(ligne.header).toBe('X-Client-IP');
  });

  it('nʼavertit pas une seconde fois depuis une autre copie du module', async () => {
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const premiere = await loadClientIp('production');
    premiere.clientIp(new Headers());

    // Un autre graphe Turbopack : même processus, module rechargé.
    const seconde = await loadClientIp('production');
    seconde.clientIp(new Headers());

    expect(avertit).toHaveBeenCalledTimes(1);
  });

  it('ignore X-Forwarded-For, forgeable par nʼimporte quel client', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {clientIp, UNKNOWN_CLIENT_IP} = await loadClientIp('production');

    expect(clientIp(new Headers({'X-Forwarded-For': '198.51.100.9'}))).toBe(UNKNOWN_CLIENT_IP);
    expect(
      clientIp(new Headers({'X-Forwarded-For': '198.51.100.9', 'X-Client-IP': '203.0.113.7'}))
    ).toBe('203.0.113.7');
    expect(clientIp(new Headers({'X-Real-IP': '198.51.100.9'}))).toBe(UNKNOWN_CLIENT_IP);
  });
});
