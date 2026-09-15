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
| `src/instrumentation.ts`, `src/lib/startup.ts` | Amorçage : configuration, contenu, puis journal, avant la première requête |
| `messages/` | Textes d'interface `fr` / `en` |
| `scripts/` | Outils de maintenance hors application (`check:content`) |
| `tests/fixtures/content/` | Contenu **fictif** : les tests ne tournent que dessus |
| `tests/fixtures/data/` | `DATA_DIR` des tests navigateur, créé par `playwright.config.ts`, ignoré par Git |

`src/proxy.ts` est le seul endroit qui pose un cookie ; `src/env.ts` la seule
porte d'entrée de la configuration ; `src/content/` le seul module qui lit
`CONTENT_DIR` ; `src/journal/` le seul qui ouvre `usage.db`. Next 16 remplace
`middleware.ts` par `proxy.ts` : il n'y a pas de `middleware.ts` dans ce dépôt.

## Le journal des visites

Chaque document servi — page, 404 — et chaque geste réel du visiteur (le
téléphone, à ce stade) passent par [`journal.touchSession()`](./src/journal/index.ts)
(AD-14) : la première apparition d'un `cv_session` crée la session, avec
l'adresse, le navigateur, la provenance et la langue ; les suivantes ne font
qu'avancer `last_seen_at`. Un `cv_visitor` jamais vu est un nouveau visiteur,
qu'il vienne d'un cookie effacé ou d'un identifiant choisi : les cookies ne sont
pas signés, et c'est une décision — l'identité de visiteur est une étiquette du
journal, pas une autorisation. Une session présentée avec le cookie d'un autre
visiteur n'est pas écrite.

Trois choses à savoir :

- **`usage.db` vit dans `DATA_DIR`, chemin absolu, répertoire existant et
  inscriptible.** Le site ne le crée pas : il refuse de démarrer, comme pour un
  contenu invalide. En mode WAL, SQLite pose `usage.db-wal` et `usage.db-shm` à
  côté ; les trois sont ignorés par Git.
- **Le journal n'efface rien** (AD-7) : insertions, plus une liste fermée de
  colonnes modifiables — ici `session.last_seen_at`, rien d'autre.
  `tests/unit/journal.test.ts` relit les sources de `src/journal/` et y refuse
  `DELETE`, `DROP`, `TRUNCATE` et `REPLACE`, ainsi que tout `UPDATE` hors de
  cette colonne — un garde textuel, pas une preuve exhaustive.
- **Le journal observe, il ne conditionne pas.** Une écriture qui échoue à la
  requête — base verrouillée par un outil externe, disque plein — est dite
  (`journal.write_failed`) et la page est servie quand même. Au démarrage, en
  revanche, un `DATA_DIR` inaccessible ou une `usage.db` en lecture seule
  arrêtent le processus. Le `User-Agent` est borné à 512 caractères ; le
  `Referer` est réduit à son origine et son chemin, sans chaîne de requête.
- **Sauvegarder à chaud, c'est copier trois fichiers** — ou un seul, proprement :
  en mode WAL, une copie de `usage.db` seul peut ignorer les dernières écritures.
  Préférer `sqlite3 usage.db ".backup copie.db"` ou `VACUUM INTO`, ou arrêter le
  service d'abord. À cadrer avec le déploiement (story 11).
- **L'adresse vient de `X-Client-IP`, posé par Caddy** (AD-15), par la seule
  fonction [`clientIp()`](./src/lib/client-ip.ts) : `dev` hors production,
  `unknown` si l'en-tête manque — avec un avertissement, une fois par processus.
  `X-Forwarded-For` n'est jamais lu.

## La page, et ce qu'elle ne sert pas

La page d'accueil **est** le CV : `/fr` et `/en` rendent l'intégralité de
[`displayProjection(lang)`](./src/content/projections.ts), dans l'ordre de
lecture de la direction A — identité, positionnement, assistant, puis parcours.
Aucun texte de CV n'est écrit dans un composant ; ce que les composants écrivent
(titres de sections, libellés des six questions, bouton du téléphone) vit dans
`messages/`. `tests/unit/page-projection.test.ts` cherche chaque valeur de la
fixture dans les sources de la page et échoue si l'une s'y trouve.

Deux choses de `cv.yaml` ne sortent d'**aucune** projection et ne s'obtiennent
que par une adresse nommée (AD-8) :

| Route | Sert | Cache |
| --- | --- | --- |
| `GET /api/photo?s=1\|2\|3` | `identite.photo`, lue une fois au démarrage — jamais son chemin — **découpée au cadre affiché** (portrait 3:4) à la densité demandée (`sharp`), métadonnées EXIF retirées ; un SVG est servi tel quel ; un fichier que `sharp` ne lit pas vaut `404`, jamais l'original | `private, no-cache` + `ETag` par variante |
| `GET /api/contact/phone` | `contact.telephone`, après un geste du visiteur, inséré côté client | `private, no-store` |
| `GET /api/contact/email` | Le courriel de Jérémie, même règle que le numéro depuis le 2026-09-15 : hors du HTML, sur geste explicite — le modèle, lui, le connaît | `private, no-store` |
| `GET /api/references/<id>/contact` | Le courriel et le numéro d'une référence — données de tiers, avec l'accord de la personne — jamais dans le HTML ni dans le contexte du modèle ; la page n'en montre que le nom et la fonction | `private, no-store` |

Le téléphone n'est donc **jamais** dans le HTML servi, et le bouton qui le
demande n'est pas rendu du tout sans JavaScript — le courriel, lui, reste là.
`tests/e2e/no-leak.spec.ts` relit le document réellement servi et y cherche
chaque valeur hors liste blanche de la fixture : téléphone, adresse, tiers,
chemins de fichiers.

**Le rendu est dynamique, et doit le rester.** `/fr` et `/en` portent
`export const dynamic = 'force-dynamic'`, et atteignent `@/content` par un
import **différé**. Les deux sont nécessaires : `force-dynamic` empêche de figer
le contenu dans l'artefact de build (AD-2 : il est lu au démarrage, un
redémarrage suffit à publier une correction), et l'import différé empêche
`@/env` d'être évalué pendant le build — sans quoi `next build` réclamerait une
clé API et un chemin de contenu. La même précaution vaut pour les deux routes
ci-dessus.

## Règles de contribution

- Aucun secret, aucune donnée personnelle réelle dans le dépôt.
- Aucune valeur de configuration en dur : tout passe par `src/env.ts`.
- Les décisions d'architecture (AD-1 à AD-17) se suivent ; une divergence se
  remonte, elle ne se décide pas localement.

## Dépendance native : `sharp`

`sharp` (redimensionnement de la photo) embarque un binaire par plateforme, choisi à
l'installation (`@img/sharp-<os>-<arch>`, dépendances optionnelles). L'artefact autonome
(`.next/standalone`) recopie celui de la machine qui a construit : **construire sur la même
plateforme que celle qui sert** — ici Windows x64 des deux côtés — ou faire `npm ci` sur le
serveur. Next 16 installe déjà `sharp` pour son propre optimiseur d'images ; il est déclaré
ici explicitement parce que le code l'importe.
