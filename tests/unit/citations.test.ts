/**
 * AD-4 / AD-16 / AD-17 — le bloc `<sources>` et les marques `[qa:…]` /
 * `[cv:…]` : retenus côté serveur quelle que soit la façon dont ils arrivent,
 * relâchés quand ce n'en est pas, contrôlés à la fin — le bloc seul pour une
 * question, la structure en quatre parties pour une évaluation.
 */
import {describe, expect, it} from 'vitest';
import {
  checkCitations,
  checkMatchCitations,
  createSourcesFilter,
  declaredSources,
  MARK_MAX_CHARS,
  MATCH_PART_ORDER,
  SOURCES_CLOSE,
  SOURCES_OPEN
} from '@/agent/citations';
import {MATCH_PARTS, MATCH_TITLES} from '@/agent/prompts';

/** Ce que le filtre relâche pour une suite de morceaux, puis à la fin. */
function run(chunks: readonly string[]) {
  const filter = createSourcesFilter();
  const out = chunks.map((chunk) => filter.push(chunk));
  const tail = filter.flush();
  return {out, tail, text: filter.text(), block: filter.block(), marks: filter.marks()};
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

  it('retire les crochets dʼun bloc écrit avec la forme des marques du mode évaluation', () => {
    expect(declaredSources('[qa:lic-01], [cv:profil]')).toEqual(['qa:lic-01', 'cv:profil']);
    expect(declaredSources('[`qa:lic-01`] `[cv:profil]`')).toEqual(['qa:lic-01', 'cv:profil']);
    // Et le contrôle les reconnaît alors comme valides.
    const filter = createSourcesFilter();
    filter.push('R.\n<sources>[qa:lic-01], [cv:profil]</sources>');
    filter.flush();
    expect(checkCitations(filter, (id) => id === 'qa:lic-01' || id === 'cv:profil')).toMatchObject({
      valid: ['qa:lic-01', 'cv:profil'],
      ok: true
    });
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

describe('les marques dʼune évaluation (AD-17)', () => {
  it('retient une marque entière et la retire du flux, avec sa position dans le texte relâché', () => {
    const {out, tail, text, marks, block} = run(['- Dix ans [cv:profil]\n']);
    expect(out).toEqual(['- Dix ans \n']);
    expect(tail).toBe('');
    expect(text).toBe('- Dix ans \n');
    expect(marks).toEqual([{id: 'cv:profil', at: 10}]);
    expect(block).toBeNull();
  });

  it('retient une marque fragmentée « [qa:l » puis « ic-01] » : rien de la marque ne sort', () => {
    const {out, tail, text, marks} = run(['- Point [qa:l', 'ic-01]\n- Suite']);
    expect(out).toEqual(['- Point ', '\n- Suite']);
    expect(tail).toBe('');
    expect(text).toBe('- Point \n- Suite');
    expect(marks).toEqual([{id: 'qa:lic-01', at: 8}]);
  });

  it('retient une marque arrivée caractère par caractère, et relâche le texte dès que possible', () => {
    const {out, text, marks} = run([...'Un point [cv:experiences.x] fin']);
    expect(out.join('')).toBe('Un point  fin');
    expect(text).toBe('Un point  fin');
    expect(marks).toEqual([{id: 'cv:experiences.x', at: 9}]);
    // « Un point » est sorti avant que le « [ » soit résolu.
    expect(out.slice(0, 9).join('')).toBe('Un point ');
  });

  it('capture deux marques adjacentes, chacune à sa position', () => {
    const {text, marks} = run(['- Point [cv:profil] [qa:lic-01]\n']);
    expect(text).toBe('- Point  \n');
    expect(marks).toEqual([
      {id: 'cv:profil', at: 8},
      {id: 'qa:lic-01', at: 9}
    ]);
  });

  it('relâche un « [ » qui nʼouvre pas une marque, avec son texte : « [voir CV] », « [c », « [qx »', () => {
    expect(run(['a [voir CV] b'])).toMatchObject({out: ['a [voir CV] b'], text: 'a [voir CV] b', marks: []});
    // « [c » pourrait encore être « [cv: » : retenu, puis relâché dès que « [ch » dit que non.
    const {out, text, marks} = run(['un [c', 'hemin] et [q', 'x]']);
    expect(out).toEqual(['un ', '[chemin] et ', '[qx]']);
    expect(text).toBe('un [chemin] et [qx]');
    expect(marks).toEqual([]);
    // Un « [ » ou un « [qa » en fin de flux nʼétait rien : cʼest du texte.
    expect(run(['texte ['])).toMatchObject({out: ['texte '], tail: '[', text: 'texte [', marks: []});
    expect(run(['texte [qa'])).toMatchObject({out: ['texte '], tail: '[qa', text: 'texte [qa', marks: []});
  });

  it('reconnaît lʼouverture quelle que soit sa casse, et nettoie accents graves et espaces', () => {
    const {text, marks} = run(['A [QA: lic-01 ] B [Cv:`profil`]']);
    expect(text).toBe('A  B ');
    expect(marks).toEqual([
      {id: 'qa:lic-01', at: 2},
      {id: 'cv:profil', at: 5}
    ]);
  });

  it('une marque jamais refermée est capturée malformée, rien nʼen sort : fin de ligne, longueur, fin de flux', () => {
    // Une fin de ligne clôt la marque ; la fin de ligne, elle, reste du texte.
    const ligne = run(['- Point [qa:lic-01\n- Suite']);
    expect(ligne.text).toBe('- Point \n- Suite');
    expect(ligne.marks).toEqual([{id: 'qa:lic-01', at: 8}]);
    // Trop long pour un identifiant : clos à la borne, malformé ; le texte reprend à la borne.
    const longue = run([`[qa:${'x'.repeat(MARK_MAX_CHARS + 1)}`, ' suite']);
    expect(longue.text).toBe('x suite');
    expect(longue.marks).toEqual([{id: `qa:${'x'.repeat(MARK_MAX_CHARS)}`, at: 0}]);
    // La fin du flux : capturée, rien ne sort.
    const fin = run(['Texte [cv:pro']);
    expect(fin.out).toEqual(['Texte ']);
    expect(fin.tail).toBe('');
    expect(fin.text).toBe('Texte ');
    expect(fin.marks).toEqual([{id: 'cv:pro', at: 6}]);
  });

  it('applique la borne au même endroit quel que soit le découpage : un morceau ou un caractère à la fois, le même texte sort', () => {
    const cas = [
      // Le `]` arrive après la borne, dans le même morceau.
      `A [qa:${'x'.repeat(500)}] B`,
      // Exactement à la borne : une marque entière.
      `A [qa:${'y'.repeat(MARK_MAX_CHARS)}] B`,
      // Un de trop : le dernier caractère et le `]` sont du texte.
      `A [qa:${'z'.repeat(MARK_MAX_CHARS + 1)}] B`,
      // Jamais refermée, plus longue que la borne.
      `A [cv:${'w'.repeat(300)} B`
    ];
    for (const texte of cas) {
      const entier = run([texte]);
      const parCaractere = run([...texte]);
      expect(parCaractere.text).toBe(entier.text);
      expect(parCaractere.marks).toEqual(entier.marks);
      expect(parCaractere.out.join('')).toBe(entier.out.join(''));
      // Jamais plus que la borne dans un identifiant capturé.
      for (const mark of entier.marks) expect(mark.id.length).toBeLessThanOrEqual(MARK_MAX_CHARS + 'qa:'.length);
    }
    expect(run([cas[0]!]).text).toBe(`A ${'x'.repeat(500 - MARK_MAX_CHARS)}] B`);
    expect(run([cas[1]!])).toMatchObject({text: 'A  B', marks: [{id: `qa:${'y'.repeat(MARK_MAX_CHARS)}`, at: 2}]});
    expect(run([cas[2]!]).text).toBe('A z] B');
    expect(run([cas[3]!]).text).toBe(`A ${'w'.repeat(300 - MARK_MAX_CHARS)} B`);
  });

  it('une marque jamais refermée suivie dʼune autre sur la même ligne ne fusionne pas avec elle', () => {
    const {text, marks} = run(['- Point [qa:lic-01 [qa:sit-02]\n']);
    expect(text).toBe('- Point \n');
    expect(marks).toEqual([
      {id: 'qa:lic-01', at: 8},
      {id: 'qa:sit-02', at: 8}
    ]);
    // Fragmentée au `[` : même chose.
    const fragmentee = run(['- Point [cv:profil ', '[qa:l', 'ic-01]']);
    expect(fragmentee.text).toBe('- Point ');
    expect(fragmentee.marks.map((mark) => mark.id)).toEqual(['cv:profil', 'qa:lic-01']);
  });

  it('marques et bloc cohabitent : le premier jeton lʼemporte, chacun est capturé', () => {
    const {text, marks, block} = run(['A [qa:a-1] B <sources>qa:a-1, cv:b</sources> C [cv:b]']);
    expect(text).toBe('A  B  C ');
    expect(marks).toEqual([
      {id: 'qa:a-1', at: 2},
      {id: 'cv:b', at: 8}
    ]);
    expect(block).toBe('qa:a-1, cv:b');
    // Dans le bloc, un « [ » nʼouvre rien : tout est le bloc.
    expect(run(['<sources>qa:a-1 [cv:b]</sources>'])).toMatchObject({block: 'qa:a-1 [cv:b]', marks: []});
  });

  it('le contrôle dʼune question ignore les marques : le bloc seul fait foi', () => {
    const filter = createSourcesFilter();
    filter.push('R [qa:lic-01].\n<sources>cv:profil</sources>');
    filter.flush();
    expect(checkCitations(filter, (id) => id === 'cv:profil' || id === 'qa:lic-01')).toEqual({
      text: 'R .',
      declared: ['cv:profil'],
      valid: ['cv:profil'],
      ok: true
    });
  });
});

describe('le contrôle dʼune évaluation (AD-17)', () => {
  const valides = new Set(['qa:lic-01', 'cv:profil', 'qa:sit-02', 'cv:experiences.x']);
  const isValid = (id: string) => valides.has(id);
  const titles = MATCH_TITLES.fr;

  /** Une évaluation complète, en ordre — le point de départ de chaque variante. */
  const ENTIERE =
    '**Points forts**\n- Dix ans [cv:experiences.x] [qa:lic-01]\n- Disponible [qa:sit-02]\n\n' +
    '**Compétences transférables**\n- Un outil voisin [voir CV] [cv:profil]\n\n' +
    '**Écarts**\n- Une certification : non documenté dans le dossier\n\n' +
    '**Conclusion**\nUn échange direct dira le reste.\n\n<sources>qa:lic-01, cv:profil</sources>';

  function check(chunks: readonly string[]) {
    const filter = createSourcesFilter();
    for (const chunk of chunks) filter.push(chunk);
    filter.flush();
    return checkMatchCitations(filter, isValid, titles);
  }

  it('en ordre : les quatre titres, chaque point marqué, rien sous les écarts, sources = union des marques et du bloc', () => {
    expect(check([ENTIERE])).toEqual({
      text:
        '**Points forts**\n- Dix ans\n- Disponible\n\n' +
        '**Compétences transférables**\n- Un outil voisin [voir CV]\n\n' +
        '**Écarts**\n- Une certification : non documenté dans le dossier\n\n' +
        '**Conclusion**\nUn échange direct dira le reste.',
      declared: ['cv:experiences.x', 'qa:lic-01', 'qa:sit-02', 'cv:profil'],
      valid: ['cv:experiences.x', 'qa:lic-01', 'qa:sit-02', 'cv:profil'],
      ok: true,
      reasons: []
    });
  });

  it('en ordre aussi quand tout arrive fragmenté, caractère par caractère', () => {
    expect(check([...ENTIERE])).toMatchObject({ok: true, reasons: []});
  });

  it('tolère un titre sans gras ou suivi dʼun deux-points, et une partie vide dite dʼune phrase sans puce', () => {
    const variante = ENTIERE.replace('**Points forts**', 'Points forts :').replace(
      '- Un outil voisin [voir CV] [cv:profil]',
      'Rien à signaler.'
    );
    expect(check([variante])).toMatchObject({ok: true, reasons: []});
  });

  it('un point est un item de liste : une partie écrite en paragraphes nʼest pas contrôlée', () => {
    // C'est la lecture retenue, et écrite : une phrase sans puce n'est pas un
    // point — le prompt demande des puces pour chaque point.
    const paragraphes = ENTIERE.replace('- Dix ans [cv:experiences.x] [qa:lic-01]\n- Disponible [qa:sit-02]', 'Dix ans et disponible.');
    expect(check([paragraphes])).toMatchObject({ok: true, reasons: []});
  });

  it.each([
    ['puce -', '- ', '**Points forts**'],
    ['puce *', '* ', '**Points forts**'],
    ['puce +', '+ ', '**Points forts**'],
    ['numéro 1.', '1. ', '**Points forts**'],
    ['titre __Titre__', '- ', '__Points forts__'],
    ['titre *Titre*', '- ', '*Points forts*'],
    ['titre _Titre_', '- ', '_Points forts_'],
    ['titre suivi dʼun deux-points', '- ', '**Points forts :**'],
    ['titre sans gras, deux-points hors gras', '- ', 'Points forts:']
  ])('forme tolérée — %s : reconnue, et un point sans marque dessous détecté', (_nom, puce, titre) => {
    const forme = ENTIERE.replace('**Points forts**', titre).replace('- Dix ans', `${puce}Dix ans`).replace(
      '- Disponible',
      `${puce}Disponible`
    );
    expect(check([forme])).toMatchObject({ok: true, reasons: []});
    expect(check([forme.replace(' [qa:sit-02]', '')]).reasons).toEqual(['unmarked_point']);
  });

  it('compare les titres après repli : forme décomposée (NFD), sans accent, casse', () => {
    const nfd = ENTIERE.replace('**Écarts**', `**${'Écarts'.normalize('NFD')}**`);
    expect('Écarts'.normalize('NFD')).not.toBe('Écarts');
    expect(check([nfd])).toMatchObject({ok: true, reasons: []});
    expect(check([ENTIERE.replace('**Écarts**', '**Ecarts**')])).toMatchObject({ok: true, reasons: []});
    expect(check([ENTIERE.replace('**Compétences transférables**', '**COMPETENCES TRANSFERABLES**')])).toMatchObject({
      ok: true,
      reasons: []
    });
    // Le mot, lui, reste exact.
    expect(check([ENTIERE.replace('**Écarts**', '**Écart**')]).reasons).toEqual(['missing_title']);
  });

  it('une ligne faite uniquement de marques appartient au point qui la précède', () => {
    const seule = ENTIERE.replace('- Disponible [qa:sit-02]', '- Disponible\n[qa:sit-02]');
    // La ligne de la marque reste, vide : le rendu Markdown ne lui donne aucun bloc.
    expect(check([seule])).toMatchObject({ok: true, reasons: [], text: expect.stringContaining('- Disponible\n\n\n**Compétences')});
    // Deux marques seules sur la ligne, puis un autre point.
    const deux = ENTIERE.replace('- Dix ans [cv:experiences.x] [qa:lic-01]', '- Dix ans\n[cv:experiences.x] [qa:lic-01]');
    expect(check([deux])).toMatchObject({ok: true, reasons: []});
    // Une vraie ligne vide, puis la marque dans un paragraphe : le point est sans marque.
    const separee = ENTIERE.replace('- Disponible [qa:sit-02]', '- Disponible\n\n[qa:sit-02] voir le dossier.');
    expect(check([separee]).reasons).toEqual(['unmarked_point']);
  });

  it('écrit lʼordre des parties une fois pour le contrôle, et cʼest celui du prompt', () => {
    expect([...MATCH_PART_ORDER]).toEqual([...MATCH_PARTS]);
  });

  it('une marque invalide, PRIVÉ ou mal formée : retirée des sources, invalid_mark', () => {
    const result = check([ENTIERE.replace('[qa:sit-02]', '[qa:inexistante]')]);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['invalid_mark']);
    expect(result.declared).toContain('qa:inexistante');
    expect(result.valid).toEqual(['cv:experiences.x', 'qa:lic-01', 'cv:profil']);
    expect(result.text).not.toContain('inexistante');
  });

  it('une source invalide dans le bloc : invalid_source, et les marques valides restent', () => {
    const result = check([ENTIERE.replace('<sources>qa:lic-01, cv:profil</sources>', '<sources>qa:sal-01</sources>')]);
    expect(result.reasons).toEqual(['invalid_source']);
    expect(result.valid).toEqual(['cv:experiences.x', 'qa:lic-01', 'qa:sit-02', 'cv:profil']);
  });

  it('un titre manquant : missing_title, la réponse est rendue telle quelle', () => {
    const result = check([ENTIERE.replace('**Écarts**\n', '')]);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['missing_title']);
    expect(result.text).toContain('- Une certification');
  });

  it('les quatre titres dans le désordre : titles_out_of_order', () => {
    const desordre = ENTIERE.replace('**Points forts**', '**Conclusion**').replace(
      '**Conclusion**\nUn échange',
      '**Points forts**\nUn échange'
    );
    expect(check([desordre]).reasons).toEqual(['titles_out_of_order']);
  });

  it('un point fort ou transférable sans marque : unmarked_point — la continuation dʼun point compte pour lui', () => {
    expect(check([ENTIERE.replace(' [qa:sit-02]', '')]).reasons).toEqual(['unmarked_point']);
    expect(check([ENTIERE.replace(' [cv:profil]', '')]).reasons).toEqual(['unmarked_point']);
    // La marque sur la ligne suivante, sans ligne vide entre : le même point.
    expect(check([ENTIERE.replace('- Disponible [qa:sit-02]', '- Disponible\n  dès demain [qa:sit-02]')]).ok).toBe(true);
  });

  it('une marque sous les écarts : mark_under_gaps', () => {
    expect(check([ENTIERE.replace('non documenté dans le dossier', 'non documenté [qa:lic-01]')]).reasons).toEqual([
      'mark_under_gaps'
    ]);
  });

  it('une marque sous la conclusion nʼest pas une faute, et compte dans les sources', () => {
    const result = check([ENTIERE.replace('dira le reste.', 'dira le reste [qa:sit-02].')]);
    expect(result.ok).toBe(true);
    expect(result.valid).toContain('qa:sit-02');
  });

  it('un refus sans structure ni bloc : missing_title, sans source, texte intact', () => {
    expect(check(['Le dossier ne couvre pas ce point.'])).toEqual({
      text: 'Le dossier ne couvre pas ce point.',
      declared: [],
      valid: [],
      ok: false,
      reasons: ['missing_title']
    });
  });

  it('cumule les raisons, chacune une fois', () => {
    const tout = ENTIERE.replace('[qa:sit-02]', '[qa:inexistante]')
      .replace(' [cv:profil]', '')
      .replace('**Conclusion**\n', '');
    expect([...check([tout]).reasons].sort()).toEqual(['invalid_mark', 'missing_title']);
  });

  it('trouve les titres anglais avec les titres anglais, pas les français', () => {
    const anglaise = ENTIERE.replace('**Points forts**', '**Strengths**')
      .replace('**Compétences transférables**', '**Transferable skills**')
      .replace('**Écarts**', '**Gaps**');
    const filter = createSourcesFilter();
    filter.push(anglaise);
    filter.flush();
    expect(checkMatchCitations(filter, isValid, MATCH_TITLES.en).ok).toBe(true);
    expect(checkMatchCitations(filter, isValid, MATCH_TITLES.fr).reasons).toEqual(['missing_title']);
  });
});
