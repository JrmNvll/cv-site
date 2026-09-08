/**
 * AD-2 — la grammaire de `qa.*.md`.
 *
 * L'analyseur est la porte d'entrée de tout ce que l'agent dira : ce qu'il
 * accepte en silence, personne ne le reverra. Ces tests couvrent donc autant ce
 * qu'il **refuse** que ce qu'il reconnaît, et vérifient que chaque refus porte
 * son numéro de ligne — sans quoi corriger 232 entrées relève de la chasse.
 */
import {describe, expect, it} from 'vitest';
import {QA_STATUSES, parseQaFile} from '@/content/qa-parser';

/** Un fichier minimal : la grammaire complète tient en quelques lignes. */
function file(...lines: string[]): string {
  return lines.join('\n');
}

const ENTREE = [
  '## 1. Bloc fictif',
  '',
  '> Note de bloc, ignorée.',
  '',
  '#### ⭐ `abc-01` — Une question fictive ?',
  '**Réponse :**',
  'Un corps **Markdown** libre.',
  '',
  '- avec une liste',
  '',
  "> **Consigne à l'agent :** une instruction fictive",
  '> sur deux lignes.',
  ''
];

describe('parseQaFile — ce qui est reconnu', () => {
  const {entries, errors} = parseQaFile(file(...ENTREE), 'fr');

  it("n'a rien à reprocher à une entrée conforme", () => {
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
  });

  it("retient l'identifiant, la question, l'étoile et le bloc", () => {
    const entry = entries[0]!;
    expect(entry.id).toBe('abc-01');
    expect(entry.question).toBe('Une question fictive ?');
    expect(entry.etoile).toBe(true);
    expect(entry.bloc).toEqual({numero: 1, titre: 'Bloc fictif', ligne: 1});
    expect(entry.ligne).toBe(5);
  });

  it('porte sa clé de citation `qa:<id>` — AD-4', () => {
    expect(entries[0]!.source).toBe('qa:abc-01');
  });

  it('conserve le corps en Markdown brut, sans la consigne', () => {
    expect(entries[0]!.corps).toBe('Un corps **Markdown** libre.\n\n- avec une liste');
    expect(entries[0]!.consigne).toBe('une instruction fictive\nsur deux lignes.');
  });

  it("n'exige pas l'étoile ni le numéro de bloc", () => {
    const parsed = parseQaFile(
      file('## Bloc sans numéro', '#### `abc-02` — Question ?', '**Réponse :**', 'Corps.'),
      'fr'
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0]!.etoile).toBe(false);
    expect(parsed.entries[0]!.bloc).toMatchObject({numero: null, titre: 'Bloc sans numéro'});
  });

  it('admet un chiffre dans le préfixe : `i2k-01` du corpus réel', () => {
    const parsed = parseQaFile(file('#### `i2k-01` — Question ?', '**Réponse :**', 'Corps.'), 'fr');
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0]!.id).toBe('i2k-01');
  });

  it('ferme une entrée sur une barre de séparation comme sur un titre', () => {
    const parsed = parseQaFile(
      file(
        '#### `abc-01` — Question ?',
        '**Réponse :**',
        'Corps.',
        '',
        '---',
        '',
        'Prose hors entrée, ignorée.'
      ),
      'fr'
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0]!.corps).toBe('Corps.');
  });
});

describe('parseQaFile — les statuts', () => {
  const build = (corps: string, consigne = '') =>
    parseQaFile(
      file('#### `abc-01` — Question ?', '**Réponse :**', corps, consigne).trimEnd(),
      'fr'
    );

  it('couvre exactement les quatre statuts du contrat', () => {
    expect([...QA_STATUSES]).toEqual(['normale', 'vide', 'PRIVÉ', 'PASSE']);
  });

  it('classe un corps ordinaire en `normale`', () => {
    expect(build('Un corps.').entries[0]!.statut).toBe('normale');
  });

  it('classe un corps vide en `vide`, sans le refuser', () => {
    const {entries, errors} = build('');
    expect(errors).toEqual([]);
    expect(entries[0]!.statut).toBe('vide');
    expect(entries[0]).not.toHaveProperty('corps');
  });

  it.each(['PRIVÉ', 'PASSE'] as const)('reconnaît le marqueur %s et retient sa consigne', (marker) => {
    const {entries, errors} = build(marker, "\n> **Consigne à l'agent :** renvoyer vers la personne fictive.");
    expect(errors).toEqual([]);
    expect(entries[0]!.statut).toBe(marker);
    expect(entries[0]!.consigne).toBe('renvoyer vers la personne fictive.');
    // Le corps d'une entrée à statut ne quitte pas la couche `content`.
    expect(entries[0]).not.toHaveProperty('corps');
  });

  it("n'accepte PRIVÉ que seul : le marqueur suivi de texte est une erreur", () => {
    const {errors} = build('PRIVÉ\n\nmais en fait voici le montant.');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('PRIVÉ');
    expect(errors[0]!.entree).toBe('abc-01');
  });
});

describe('parseQaFile — ce qui fait échouer le démarrage', () => {
  it('refuse un marqueur entre crochets, en nommant la ligne et l’entrée', () => {
    const {errors} = parseQaFile(
      file('', '#### `abc-01` — Question ?', '**Réponse :**', '[BROUILLON] à relire.'),
      'fr'
    );
    expect(errors).toEqual([
      {ligne: 4, entree: 'abc-01', message: expect.stringContaining('crochets')}
    ]);
    // Le message part sur stderr, donc dans le journal du service : il situe
    // l'anomalie, il ne recopie pas le contenu privé.
    expect(errors[0]!.message).not.toContain('BROUILLON');
  });

  it.each(['OUI.', 'SQL, PHP, HTML.', 'À RELIRE', 'NON'])(
    'accepte « %s » comme corps : seuls PRIVÉ et PASSE sont des marqueurs',
    (corps) => {
      const {errors, entries} = parseQaFile(
        file('#### `abc-01` — Question ?', '**Réponse :**', corps),
        'fr'
      );
      expect(errors).toEqual([]);
      expect(entries[0]!.statut).toBe('normale');
      expect(entries[0]!.corps).toBe(corps);
    }
  );

  it('laisse passer un lien Markdown en tête de corps', () => {
    const {errors, entries} = parseQaFile(
      file('#### `abc-01` — Question ?', '**Réponse :**', '[le site](https://exemple.invalid) le dit.'),
      'fr'
    );
    expect(errors).toEqual([]);
    expect(entries[0]!.statut).toBe('normale');
  });

  it('refuse un identifiant dupliqué en nommant la première définition', () => {
    const {errors, entries} = parseQaFile(
      file(
        '#### `abc-01` — Première ?',
        '**Réponse :**',
        'Un.',
        '',
        '#### `abc-01` — Seconde ?',
        '**Réponse :**',
        'Deux.'
      ),
      'fr'
    );
    expect(entries).toHaveLength(1);
    expect(errors).toEqual([
      {ligne: 5, entree: 'abc-01', message: expect.stringContaining('ligne 1')}
    ]);
  });

  it('refuse un identifiant hors format', () => {
    const {errors} = parseQaFile(
      file('#### `Abc_1` — Question ?', '**Réponse :**', 'Corps.'),
      'fr'
    );
    expect(errors[0]).toMatchObject({ligne: 1, message: expect.stringContaining('Abc_1')});
  });

  it("refuse un en-tête d'entrée qui n'a pas la forme du contrat", () => {
    const {errors} = parseQaFile(file('#### abc-01 : Question ?', '**Réponse :**', 'Corps.'), 'fr');
    expect(errors[0]).toMatchObject({ligne: 1});
  });

  it('refuse une entrée sans marqueur de réponse', () => {
    const {errors} = parseQaFile(file('#### `abc-01` — Question ?', ''), 'fr');
    expect(errors).toEqual([{ligne: 1, entree: 'abc-01', message: expect.stringContaining('Réponse')}]);
  });

  it('refuse une ligne glissée entre la question et sa réponse', () => {
    const {errors} = parseQaFile(
      file('#### `abc-01` — Question ?', 'Une note égarée.', '**Réponse :**', 'Corps.'),
      'fr'
    );
    expect(errors[0]).toMatchObject({ligne: 2, entree: 'abc-01'});
  });

  it('rend toutes les anomalies du fichier, pas la première', () => {
    const {errors} = parseQaFile(
      file(
        '#### `abc-01` — Une ?',
        '**Réponse :**',
        '[BROUILLON]',
        '',
        '#### `Abc_2` — Deux ?',
        '**Réponse :**',
        'Corps.',
        '',
        '### Titre de niveau interdit'
      ),
      'fr'
    );
    expect(errors.map((issue) => issue.ligne)).toEqual([3, 5, 9]);
  });
});

describe('parseQaFile — ce qui protégeait mal le corps', () => {
  it("ne lit aucune structure à l'intérieur d'un bloc de code clôturé", () => {
    // Une réponse qui explique le format du corpus contient tout ce que
    // l'analyseur cherche. Sans état de clôture, elle est tronquée en silence
    // — ou fabrique une entrée fantôme qui bloque le démarrage.
    const {entries, errors} = parseQaFile(
      file(
        '#### \`site-01\` — À quoi ressemble une entrée du corpus ?',
        '**Réponse :**',
        'Comme ceci :',
        '',
        '```markdown',
        '#### \`exemple-01\` — Une question ?',
        '**Réponse :**',
        'Un corps.',
        '',
        '---',
        '```',
        '',
        'Et rien de plus.'
      ),
      'fr'
    );
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('site-01');
    expect(entries[0]!.corps).toContain('#### \`exemple-01\`');
    expect(entries[0]!.corps).toContain('Et rien de plus.');
  });

  it('refuse un bloc de code jamais refermé plutôt que d’avaler la suite', () => {
    const {errors} = parseQaFile(
      file(
        '#### \`abc-01\` — Question ?',
        '**Réponse :**',
        '```',
        'du code sans fin',
        '',
        '#### \`abc-02\` — Autre ?',
        '**Réponse :**',
        'Perdue.'
      ),
      'fr'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('jamais refermé');
  });

  it('rend le corps tel quel : espaces insécables et retours forcés compris', () => {
    const corps = ['Un texte avec un espace insécable.  ', 'et un retour forcé.'].join('\n');
    const {entries} = parseQaFile(
      file('#### \`abc-01\` — Question ?', '**Réponse :**', corps),
      'fr'
    );
    // AD-3 : le corps part au modèle sans retouche. Normaliser ici retirerait
    // silencieusement la mise en forme voulue par l'auteur.
    expect(entries[0]!.corps).toBe(corps);
  });

  it("rattache à la consigne les lignes de citation séparées par une ligne vide", () => {
    const {entries} = parseQaFile(
      file(
        '#### \`abc-01\` — Question ?',
        '**Réponse :**',
        'Le corps.',
        '',
        "> **Consigne à l'agent :** première instruction.",
        '',
        '> Seconde instruction.',
        '',
        'Suite du corps.'
      ),
      'fr'
    );
    // Sans quoi une instruction destinée à l'agent serait servie comme réponse.
    expect(entries[0]!.consigne).toBe('première instruction.\n\nSeconde instruction.');
    expect(entries[0]!.corps).toBe('Le corps.\n\nSuite du corps.');
  });

  it("accepte l'apostrophe typographique dans le marqueur de consigne", () => {
    const {entries} = parseQaFile(
      file(
        '#### \`abc-01\` — Question ?',
        '**Réponse :**',
        'Le corps.',
        '',
        '> **Consigne à l\u2019agent :** une instruction.'
      ),
      'fr'
    );
    // Un éditeur qui substitue l'apostrophe ferait autrement disparaître la
    // consigne dans le corps, servie telle quelle au visiteur.
    expect(entries[0]!.consigne).toBe('une instruction.');
    expect(entries[0]!.corps).toBe('Le corps.');
  });

  it('voit une entrée précédée d’un BOM', () => {
    const {entries, errors} = parseQaFile(
      '﻿' + file('#### \`abc-01\` — Question ?', '**Réponse :**', 'Un corps.'),
      'fr'
    );
    // Invisible à la relecture : l'entrée disparaîtrait sans la moindre erreur,
    // en fabriquant un faux orphelin ou une fausse traduction manquante.
    expect(errors).toEqual([]);
    expect(entries.map((entry) => entry.id)).toEqual(['abc-01']);
  });
});
