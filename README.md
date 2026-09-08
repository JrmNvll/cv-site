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
| `messages/` | Textes d'interface `fr` / `en` |
| `tests/fixtures/content/` | Contenu **fictif** : les tests ne tournent que dessus |

`src/proxy.ts` est le seul endroit qui pose un cookie ; `src/env.ts` la seule
porte d'entrée de la configuration. Next 16 remplace `middleware.ts` par
`proxy.ts` : il n'y a pas de `middleware.ts` dans ce dépôt.

## Règles de contribution

- Aucun secret, aucune donnée personnelle réelle dans le dépôt.
- Aucune valeur de configuration en dur : tout passe par `src/env.ts`.
- Les décisions d'architecture (AD-1 à AD-17) se suivent ; une divergence se
  remonte, elle ne se décide pas localement.
