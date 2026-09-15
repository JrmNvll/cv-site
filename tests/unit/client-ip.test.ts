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
