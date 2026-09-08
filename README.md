# cv-site

Site CV bilingue, interrogeable, pour `cv.jnouvelle.com`. **Dépôt public de code
uniquement** : le contenu (CV, questions/réponses, photo) est privé et vit dans
`CONTENT_DIR`, hors de ce dépôt.

## Prérequis

- Node.js 24 LTS (`engines` l'impose à l'installation).
- Un `.env.local` complet — copier `.env.example` et remplir. Le **démarrage**
  échoue tant qu'une variable requise manque ; le build, lui, n'a besoin
  d'aucun secret.

## Vérifier le dépôt

```sh
npm run verify
```

C'est **la** commande de vérification : elle enchaîne `lint`, `typecheck`,
`test` et `test:e2e`. Rien n'est considéré vérifié tant qu'elle n'est pas verte
— en particulier `noindex`, l'attribut `lang`, les cookies de visite et leur
`Cache-Control`, qui ne sont prouvés que par le navigateur. Les tests
navigateur construisent et servent l'**artefact de production** : `next dev`
réécrit `Cache-Control` pour son rechargement à chaud et masquerait le
comportement réel.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | Développement sur `http://127.0.0.1:3000` |
| `npm run build` | Build autonome (`.next/standalone/server.js`) |
| `npm run start` | Sert le build autonome (`node .next/standalone/server.js`) |
| `npm run lint` | ESLint, frontières de couches comprises |
| `npm run typecheck` | `next typegen` puis `tsc --noEmit` |
| `npm run test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests navigateur (Playwright ; construit puis sert l'artefact de production) |
| `npm run verify` | Les quatre précédents, dans l'ordre |
| `npm run check:content` | Valide le contenu **réel** de `CONTENT_DIR` — hors `verify` |

## Le contenu, et pourquoi il n'est pas ici

Le CV et les réponses aux questions de recrutement sont des **données
personnelles**. Elles ne sont pas dans ce dépôt et n'y entreront jamais (AD-2) :
le code les lit au démarrage dans `CONTENT_DIR`, qui contient `cv.yaml`,
`qa.fr.md`, `qa.en.md` (optionnel) et `assets/`. Le dépôt ne contient que
`tests/fixtures/content/` — un jeu **fictif**, valide selon le même schéma, sur
lequel tournent tous les tests. C'est pourquoi `npm run verify` est vert sur une
machine qui n'a pas le dépôt privé.

Un contenu invalide **arrête le démarrage** : mieux vaut ne rien servir qu'une
page dégradée ou une réponse approximative. Pour corriger sans relancer le
serveur à chaque faute, `check:content` fait le même travail en ligne de commande
et rapporte **toutes** les anomalies d'un coup, fichier et ligne à l'appui, plus
un état des lieux : entrées par langue, statuts, écarts d'identifiants entre le
français et l'anglais, champs ignorés.

```sh
npm run check:content                       # CONTENT_DIR pris dans l'env ou .env.local
npm run check:content -- c:/chemin/content
```

Il ne fait pas partie de `verify`, qui doit rester exécutable sans le contenu
réel. Rien de ce qu'il affiche n'est le corps d'une entrée.

Ce que le site expose du CV est décidé une fois, par **liste blanche**, dans
[`src/content/projections.ts`](./src/content/projections.ts) : deux projections
distinctes, `display` pour la page et `agent` pour le modèle (AD-8). Un champ
ajouté à `cv.yaml` ne sort de nulle part tant qu'il n'a pas été ajouté là — et
`tests/unit/projection-leak.test.ts` échoue s'il en sort quand même.

Trois règles méritent d'être connues avant de toucher au contenu :

- **Chaque nœud citable porte un `id` écrit à la main** — `experiences`,
  `formation`, `competences`, `certificats_travail`. Ces identifiants deviennent
  des clés de citation (`cv:experiences.<id>`, AD-4) : renommer un libellé ou
  intervertir deux entrées ne doit pas déplacer une citation déjà émise. Le
  démarrage échoue si un `id` manque ou apparaît deux fois.
- **Le corps d'une réponse part au modèle tel quel.** Les seuls marqueurs sont
  `PRIVÉ` et `PASSE`, seuls sur leur ligne ; « OUI. » ou « SQL, PHP, HTML. » sont
  des réponses ordinaires. Un bloc de code clôturé (```` ``` ````) protège tout ce
  qu'il contient, `####` et `**Réponse :**` cités en exemple compris.
- **`CONTENT_DIR` est un chemin absolu.** Le build autonome se place dans
  `.next/standalone` avant de démarrer ; `src/env.ts` refuse un chemin relatif
  plutôt que de faire chercher un `cv.yaml` fantôme.

## Structure

Monolithe modulaire en couches, un seul processus Next.js. Les dépendances
pointent vers l'intérieur ; une flèche absente du graphe est interdite.

**Le graphe fait foi dans [`layers.config.mjs`](./layers.config.mjs)** — et
nulle part ailleurs. `eslint.config.mjs` en tire les règles de lint,
`tests/unit/layers.test.ts` les vérifications que le lint ne peut pas faire
(imports dynamiques). Modifier une frontière, c'est modifier ce fichier.

| Répertoire | Rôle |
| --- | --- |
| `src/content/` | Chargement et validation du contenu de `CONTENT_DIR`, projections `display` / `agent` |
| `src/knowledge/` | Index de récupération lexicale par langue, noyau, index des titres |
| `src/agent/` | `ask()` / `match()`, passerelle Anthropic, plafond de dépense, citations |
| `src/journal/` | Seul propriétaire de `usage.db` : visiteurs, sessions, échanges |
| `src/app/`, `src/proxy.ts` | Routes, cookies, i18n, rendu |
| `src/env.ts`, `src/lib/`, `src/i18n/` | Code partagé — n'importe **aucune** couche |
| `src/instrumentation.ts`, `src/lib/startup.ts` | Amorçage : configuration puis contenu, avant la première requête |
| `messages/` | Textes d'interface `fr` / `en` |
| `scripts/` | Outils de maintenance hors application (`check:content`) |
| `tests/fixtures/content/` | Contenu **fictif** : les tests ne tournent que dessus |

`src/proxy.ts` est le seul endroit qui pose un cookie ; `src/env.ts` la seule
porte d'entrée de la configuration ; `src/content/` le seul module qui lit
`CONTENT_DIR`. Next 16 remplace `middleware.ts` par `proxy.ts` : il n'y a pas de
`middleware.ts` dans ce dépôt.

## Règles de contribution

- Aucun secret, aucune donnée personnelle réelle dans le dépôt.
- Aucune valeur de configuration en dur : tout passe par `src/env.ts`.
- Les décisions d'architecture (AD-1 à AD-17) se suivent ; une divergence se
  remonte, elle ne se décide pas localement.
