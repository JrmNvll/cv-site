/**
 * AD-4 / AD-16 — le bloc `<sources>` : retenu côté serveur quelle que soit la
 * façon dont il arrive, relâché quand ce n'en est pas un, contrôlé à la fin.
 */
import {describe, expect, it} from 'vitest';
import {
  checkCitations,
  createSourcesFilter,
  declaredSources,
  SOURCES_CLOSE,
  SOURCES_OPEN
} from '@/agent/citations';

/** Ce que le filtre relâche pour une suite de morceaux, puis à la fin. */
function run(chunks: readonly string[]) {
  const filter = createSourcesFilter();
  const out = chunks.map((chunk) => filter.push(chunk));
  const tail = filter.flush();
  return {out, tail, text: filter.text(), block: filter.block()};
}

describe('le filtre de flux', () => {
  it('laisse passer un texte sans bloc, morceau par morceau', () => {
    const {out, tail, text, block} = run(['Bonjour ', 'le **monde**.\n\n- a\n', '- b']);
    expect(out).toEqual(['Bonjour ', 'le **monde**.\n\n- a\n', '- b']);
    expect(tail).toBe('');
    expect(text).toBe('Bonjour le **monde**.\n\n- a\n- b');
    expect(block).toBeNull();
  });

  it('retient un bloc entier arrivé dʼun coup, et le capture', () => {
    const {out, text, block} = run(['Réponse.\n\n<sources>qa:lic-01, cv:profil</sources>']);
    expect(out).toEqual(['Réponse.\n\n']);
    expect(text).toBe('Réponse.\n\n');
    expect(block).toBe('qa:lic-01, cv:profil');
  });

  it('retient un bloc fragmenté « <sour » puis « ces>… » : rien du bloc ne sort', () => {
    const {out, tail, text, block} = run(['Réponse.\n\n<sour', 'ces>qa:inexistante, qa:lic-01</sources>']);
    expect(out).toEqual(['Réponse.\n\n', '']);
    expect(tail).toBe('');
    expect(text).toBe('Réponse.\n\n');
    expect(block).toBe('qa:inexistante, qa:lic-01');
  });

  it('retient un bloc arrivé caractère par caractère', () => {
    const texte = 'Fin.\n<sources>qa:a-1,cv:b</sources>';
    const chunks = [...texte];
    const {out, text, block} = run(chunks);
    expect(out.join('')).toBe('Fin.\n');
    expect(text).toBe('Fin.\n');
    expect(block).toBe('qa:a-1,cv:b');
    // Ce qui est relâché l'est dès que possible : « Fin.\n » est sorti avant le « < ».
    expect(out.slice(0, 5).join('')).toBe('Fin.\n');
  });

  it('relâche un « < » isolé qui nʼest pas suivi du bloc, avec le texte', () => {
    const {out, tail, text} = run(['a <', ' b et 2 < 3', ' <b>gras</b>', ' <sourc', 'ier>']);
    expect(out[0]).toBe('a ');
    expect(out[1]).toBe('< b et 2 < 3');
    expect(out[2]).toBe(' <b>gras</b>');
    // « <sourc » pourrait encore être le bloc : retenu…
    expect(out[3]).toBe(' ');
    // …et relâché dès que « ier> » dit que non.
    expect(out[4]).toBe('<sourcier>');
    expect(tail).toBe('');
    expect(text).toBe('a < b et 2 < 3 <b>gras</b> <sourcier>');
  });

  it('relâche à la fin un « < » ou un « <sour » resté en attente : ce nʼétait pas le bloc', () => {
    expect(run(['texte <'])).toMatchObject({out: ['texte '], tail: '<', text: 'texte <', block: null});
    expect(run(['texte <sour'])).toMatchObject({out: ['texte '], tail: '<sour', text: 'texte <sour', block: null});
  });

  it('garde un bloc ouvert et jamais refermé : cʼest le bloc quand même, rien ne sort', () => {
    const {out, tail, text, block} = run(['Réponse.\n<sources>qa:lic-01, qa:sit']);
    expect(out).toEqual(['Réponse.\n']);
    expect(tail).toBe('');
    expect(text).toBe('Réponse.\n');
    expect(block).toBe('qa:lic-01, qa:sit');
  });

  it('relâche ce qui suit un bloc refermé, et cumule un second bloc', () => {
    const {out, text, block} = run(['A <sources>qa:x-1</sources> B <sources>cv:y</sources>']);
    expect(out).toEqual(['A  B ']);
    expect(text).toBe('A  B ');
    expect(block).toBe('qa:x-1,cv:y');
  });

  it('reconnaît les balises quelle que soit leur casse, dʼun coup ou fragmentées', () => {
    expect(run(['R.\n<Sources>qa:a-1</Sources>'])).toMatchObject({text: 'R.\n', block: 'qa:a-1'});
    expect(run(['R.\n<SOURCES>qa:a-1</SOURCES>'])).toMatchObject({text: 'R.\n', block: 'qa:a-1'});
    const {out, text, block} = run(['R. <SOUR', 'ces>qa:a-1</sour', 'CES>']);
    expect(out.join('')).toBe('R. ');
    expect(text).toBe('R. ');
    expect(block).toBe('qa:a-1');
  });

  it('retire un </sources> orphelin, entier ou fragmenté, et laisse passer le texte autour', () => {
    expect(run(['A </sources> B'])).toMatchObject({out: ['A  B'], text: 'A  B', block: null});
    const {out, tail, text} = run(['A </sour', 'ces> B']);
    expect(out).toEqual(['A ', ' B']);
    expect(tail).toBe('');
    expect(text).toBe('A  B');
    // Un « </sou » en fin de flux n'était rien : c'est du texte.
    expect(run(['A </sou'])).toMatchObject({tail: '</sou', text: 'A </sou'});
  });

  it('expose le format exact que les règles du prompt annoncent', () => {
    expect(SOURCES_OPEN).toBe('<sources>');
    expect(SOURCES_CLOSE).toBe('</sources>');
  });
});

describe('les identifiants déclarés', () => {
  it('nettoie, dédoublonne et garde lʼordre', () => {
    expect(declaredSources(' qa:lic-01 ,`cv:profil`, qa:lic-01\ncv:experiences.x ; ')).toEqual([
      'qa:lic-01',
      'cv:profil',
      'cv:experiences.x'
    ]);
    // Des espaces seuls séparent aussi : deux clés, pas une clé fausse.
    expect(declaredSources('qa:a-1 qa:b-2\tcv:profil')).toEqual(['qa:a-1', 'qa:b-2', 'cv:profil']);
    expect(declaredSources('')).toEqual([]);
    expect(declaredSources(null)).toEqual([]);
  });
});

describe('le contrôle final', () => {
  const valides = new Set(['qa:lic-01', 'cv:profil', 'qa:sit-01']);
  const isValid = (id: string) => valides.has(id);

  it('sans bloc — un refus — : rien de déclaré, tout est en ordre', () => {
    const filter = createSourcesFilter();
    filter.push('Le dossier ne couvre pas ce point.');
    filter.flush();
    expect(checkCitations(filter, isValid)).toEqual({
      text: 'Le dossier ne couvre pas ce point.',
      declared: [],
      valid: [],
      ok: true
    });
  });

  it('avec un bloc valide : les sources, dans lʼordre, et ok', () => {
    const filter = createSourcesFilter();
    filter.push('R.\n\n<sources>cv:profil, qa:lic-01</sources>');
    filter.flush();
    expect(checkCitations(filter, isValid)).toEqual({
      text: 'R.',
      declared: ['cv:profil', 'qa:lic-01'],
      valid: ['cv:profil', 'qa:lic-01'],
      ok: true
    });
  });

  it('retire une source invalide, PRIVÉ ou mal formée, et dit que ce nʼest pas en ordre', () => {
    const filter = createSourcesFilter();
    filter.push('R.<sources>qa:inexistante, qa:lic-01, qa:sal-01, lic-01, QA:LIC-01, cv:../x</sources>');
    filter.flush();
    expect(checkCitations(filter, isValid)).toEqual({
      text: 'R.',
      declared: ['qa:inexistante', 'qa:lic-01', 'qa:sal-01', 'lic-01', 'QA:LIC-01', 'cv:../x'],
      valid: ['qa:lic-01'],
      ok: false
    });
  });

  it('un bloc vide déclare rien : ok, sans source', () => {
    const filter = createSourcesFilter();
    filter.push('R.<sources></sources>');
    filter.flush();
    expect(checkCitations(filter, isValid)).toMatchObject({declared: [], valid: [], ok: true});
  });
});
