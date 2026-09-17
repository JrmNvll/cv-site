# cv-site

Site CV bilingue, interrogeable, pour `cv.jnouvelle.com`. **Dépôt public de code
uniquement** : le contenu (CV, questions/réponses, photo) est privé et vit dans
`CONTENT_DIR`, hors de ce dépôt.

## Prérequis

- Node.js 24 LTS (`engines` l'impose à l'installation).
- Un `.env.local` complet — copier `.env.example` et remplir. Le **démarrage**
  échoue tant qu'une variable requise manque ; le build, lui, n'a besoin
  d'aucun secret. `ANTHROPIC_BASE_URL` reste **vide** hors des tests : c'est
  l'adresse du simulateur, jamais celle de l'API réelle.

## Vérifier le dépôt

```sh
npm run verify
```

C'est **la** commande de vérification : elle enchaîne `lint`, `typecheck`,
`test` et `test:e2e`. Rien n'est considéré vérifié tant qu'elle n'est pas verte
— en particulier `noindex`, l'attribut `lang`, les cookies de visite et leur
`Cache-Control`, le texte de l'assistant qui arrive au fil de l'eau, qui ne
sont prouvés que par le navigateur. Les tests navigateur construisent et
servent l'**artefact de production** : `next dev` réécrit `Cache-Control` pour
son rechargement à chaud et masquerait le comportement réel. Ils lancent aussi
un **simulateur de l'API du modèle** (`tests/e2e/model-stub/server.mjs`) :
aucun test n'appelle l'API réelle, rien n'est facturé. La suite adverse contre
l'API réelle (story 10) est à part et se lance sur demande.

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
| `npm run stub` | Lance le simulateur de l'API du modèle (`MODEL_STUB_PORT`, 3901 par défaut) — pour un essai à la main |

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
| `src/instrumentation.ts`, `src/lib/startup.ts` | Amorçage : configuration, contenu, connaissance, puis journal, avant la première requête |
| `messages/` | Textes d'interface `fr` / `en` |
| `scripts/` | Outils de maintenance hors application (`check:content`) |
| `tests/fixtures/content/` | Contenu **fictif** : les tests ne tournent que dessus |
| `tests/fixtures/data/` | `DATA_DIR` des tests navigateur, créé par `playwright.config.ts`, ignoré par Git |
| `tests/e2e/model-stub/` | Le simulateur de l'API du modèle des tests navigateur, et ses scénarios |

`src/proxy.ts` est le seul endroit qui pose un cookie ; `src/env.ts` la seule
porte d'entrée de la configuration ; `src/content/` le seul module qui lit
`CONTENT_DIR` ; `src/journal/` le seul qui ouvre `usage.db` ;
`src/agent/gateway.ts` le seul qui importe le SDK du modèle. Next 16 remplace
`middleware.ts` par `proxy.ts` : il n'y a pas de `middleware.ts` dans ce dépôt.

## Le journal des visites

Chaque document servi — page, 404 — et chaque geste réel du visiteur (les
coordonnées à la demande, une question du premier écran) passent par
[`journal.touchSession()`](./src/journal/index.ts)
(AD-14) : la première apparition d'un `cv_session` crée la session, avec
l'adresse, le navigateur, la provenance et la langue ; les suivantes ne font
qu'avancer `last_seen_at`. Un `cv_visitor` jamais vu est un nouveau visiteur,
qu'il vienne d'un cookie effacé ou d'un identifiant choisi : les cookies ne sont
pas signés, et c'est une décision — l'identité de visiteur est une étiquette du
journal, pas une autorisation. Une session présentée avec le cookie d'un autre
visiteur n'est pas écrite. Une question du premier écran insère en plus un
`exchange` de sorte `hero` (`journal.addExchange()`), finalisé d'emblée : coût
nul, aucun jeton, la clé de citation de l'entrée en source — cent par session
au plus, au-delà la réponse est servie sans être journalisée. Une question
libre suit la séquence d'AD-6 : `reserveExchange()` en `pending` **avant**
l'appel, `finalizeExchange()` après, avec les quatre compteurs et le coût réel
(voir « L'assistant » plus bas).

Ce qu'il faut savoir :

- **`usage.db` vit dans `DATA_DIR`, chemin absolu, répertoire existant et
  inscriptible.** Le site ne le crée pas : il refuse de démarrer, comme pour un
  contenu invalide. En mode WAL, SQLite pose `usage.db-wal` et `usage.db-shm` à
  côté ; les trois sont ignorés par Git.
- **Le schéma est versionné** (`PRAGMA user_version`, version 3 depuis la story
  6 : `exchange.kind` admet `hero`, `exchange.status` admet `cap_reached`). Une
  base plus récente que le code est refusée ; une base plus ancienne aussi,
  tant qu'aucun mécanisme de migration n'existe — avant la mise en ligne, une
  `usage.db` d'une version antérieure se recrée : supprimer le fichier et ses
  compagnons `-wal` et `-shm`, redémarrer.
- **Le journal n'efface rien** (AD-7) : insertions, plus une liste fermée de
  colonnes modifiables — `session.last_seen_at`, et la finalisation d'un
  échange réservé (`status`, `answer`, `sources`, `citation_ok`, les quatre
  compteurs, `cost_micro_usd`, `latency_ms`), qui n'atteint qu'une ligne
  `pending`. `tests/unit/journal.test.ts` relit les sources de `src/journal/`
  et y refuse `DELETE`, `DROP`, `TRUNCATE` et `REPLACE` — même en commentaire —
  ainsi que tout `UPDATE` qui ne soit pas l'une de ces deux formes exactes :
  `UPDATE session SET last_seen_at = … WHERE id = ?` (une seule affectation,
  celle-là), ou `UPDATE exchange SET <colonnes de la liste ci-dessus, chacune
  une fois> WHERE id = ? AND status = 'pending'` (exactement cette clause).
  Un garde textuel, pas une preuve exhaustive.
- **Une réservation orpheline se règle au démarrage.** Un processus tué entre
  la réservation et la finalisation laisserait une ligne `pending` comptée
  tout le mois. À l'ouverture, `settleStalePending()` finalise en
  `model_error`, à la réservation, sans réponse ni compteurs, toute ligne
  `pending` vieille de dix minutes ou plus (`PENDING_STALE_MS`), et le dit
  (`journal.pending_settled`, avec le nombre). Le cumul ne change pas : ce
  qui était réservé reste compté, ce qui est juste.
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

**Les cinq questions du premier écran répondent sans appeler le modèle** (CAP-2).
`GET /api/questions/<id>?lang=fr|en` ne sert que les cinq identifiants de
[`hero-questions.ts`](./src/app/[locale]/_components/hero-questions.ts), dans la
langue que la page demande, et rend le corps de l'entrée **tel qu'écrit**, en
Markdown, rendu côté client par un sous-ensemble maîtrisé
([`markdown.tsx`](./src/app/[locale]/_components/markdown.tsx) : paragraphes,
listes, gras, italique — tout le reste en texte, jamais de HTML injecté). Une
entrée `PRIVÉ`, `PASSE` ou vide vaut `404`. Sans JavaScript, les six puces et
le champ libre restent désactivés ; la sixième (l'annonce à coller) ouvre,
une fois hydratée, la zone de l'évaluation d'adéquation (voir plus bas).

## L'assistant : ancrage, passerelle, plafond

**Le champ libre et l'annonce collée appellent le modèle** (CAP-3, CAP-4), et
c'est la seule chose du site qui coûte de l'argent. Tout ce qui suit existe
pour que la réponse soit fondée sur le dossier et rien d'autre, et pour que la
dépense reste sous 5 USD par mois quoi qu'il arrive (CAP-8).

**La connaissance** (`src/knowledge/`) se construit **au démarrage**, par
langue, et ne change plus : le **noyau** — la projection `agent` de `cv.yaml`
avec ses clés de citation, l'index des titres de toutes les entrées, le corps
des entrées `sys-*`, et l'identifiant + la consigne des entrées `PRIVÉ` ou à
consigne, **jamais le corps d'une entrée `PRIVÉ`** — et l'**index BM25+**
(MiniSearch) sur le texte débalisé des entrées ordinaires. Le noyau d'une langue
est identique octet pour octet d'un appel à l'autre : c'est le préfixe de cache
du modèle, et la taille de chacun est journalisée au démarrage
(`knowledge.ready`). Un `qa.en.md` absent fait s'ancrer `/en` sur le corpus
français avec la consigne de répondre en anglais (`knowledge.corpus_fallback`,
une fois par processus).

**L'agent** (`src/agent/`) reçoit `{lang, visitorId, sessionId, ip, question}`
et ne lit jamais la requête. `ask()` valide (1 à 1 000 caractères, caractères
invisibles retirés, langue servie), passe le **limiteur**, relit les six
derniers échanges de la session, assemble le contexte — règles fixes puis
noyau dans un seul bloc `system` en cache ; dans les messages, l'historique,
puis les douze entrées les mieux classées dans `<dossier>` et la question dans
`<question>`, deux blocs fermés dont seul le premier fait foi — et appelle la
**passerelle** (`gateway.ts`, le seul fichier qui importe le SDK), dont la
séquence ne varie jamais : réservation dans **une transaction du journal**
(cumul du mois — somme de `exchange.cost_micro_usd` depuis le 1er du mois UTC,
réservations `pending` comprises — puis refus `cap_reached` si cumul +
réservation > 5 USD, sinon insertion `pending` avec la réservation, sous le
même verrou : deux requêtes ne passent pas toutes deux juste sous le plafond)
→ appel → finalisation avec les quatre compteurs et le coût réel depuis la
table de prix datée (`pricing.ts`). Une réservation impossible vaut aucun
appel ; **l'abandon du client n'interrompt ni l'appel ni la finalisation** :
un appel facturé est un appel compté. Le bloc `<sources>` que le modèle écrit
en fin de réponse est retenu **côté serveur** (`citations.ts`), jamais
transmis ; chaque source déclarée est vérifiée, une source invalide est
retirée et `citation_ok` passe à 0.

**Une reprise, et son prix.** Le SDK reprend l'appel **une fois** après un
délai de connexion. Si ce délai tombe alors que l'API a déjà reçu la requête,
l'appel rejoué peut être facturé deux fois quand le journal n'en compte qu'un
— celui dont les compteurs reviennent. Le cumul peut donc **sous-estimer** la
dépense réelle, d'au plus un appel par reprise ; c'est le prix d'une reprise
qui absorbe un incident réseau ordinaire, et c'est dit ici plutôt que caché.

**Le limiteur** : trois fenêtres glissantes en mémoire — 10 questions / 15 min
par visiteur, 10 / 15 min par adresse, 60 / h pour le site — consommées
ensemble ou pas du tout. **Son état est perdu au redémarrage** ; c'est le
plafond persistant du journal qui protège l'argent, pas lui. Un refus de débit
n'est pas journalisé ; un refus au plafond l'est (`status = 'cap_reached'`,
coût nul, question conservée).

**L'évaluation d'adéquation** (CAP-4, AD-17) : la sixième puce ouvre une zone
où coller une annonce (1 à 8 000 caractères, le compte affiché), envoyée à
`POST /api/match`. `match()` est `ask()` en tout point — même limiteur (une
annonce compte comme une question), même historique, même passerelle, même
plafond — sauf trois choses : l'annonce est la requête de récupération et
part dans `<annonce>` au lieu de `<question>` ; **le bloc `system` est le
même octet pour octet** (les règles décrivent les deux modes, c'est le
dernier message qui dit lequel — un second prompt ferait un second préfixe de
cache à payer) ; et la réponse a une **structure imposée**, quatre titres en
gras seuls sur leur ligne, dans cet ordre et dans la langue de la page
(`MATCH_TITLES`, `src/agent/prompts.ts`) : points forts, compétences
transférables, écarts, conclusion. Chaque point des deux premières parties —
une puce « - », cinq au plus par partie — se termine par une ou plusieurs
**marques** `[qa:<id>]` / `[cv:<chemin>]` ; les écarts n'en portent aucune et
sont formulés « non documenté dans le dossier » — jamais une incapacité ; la
conclusion renvoie à l'échange direct ; jamais de note, de pourcentage ni de
verdict. Les marques sont **retenues et retirées côté serveur** par le même
automate que le bloc (`citations.ts` : un `[` qui peut ouvrir `[qa:` ou
`[cv:` est tenu, tout autre `[` est relâché avec son texte ; une marque jamais
refermée est close à la fin de sa ligne ou à 120 caractères, rien n'en sort)
— le navigateur ne voit jamais un identifiant, seulement « N sources ». Les
sources journalisées et transmises sont l'union des marques valides et du bloc
valide. **`citation_ok` veut dire « tout en ordre »** pour une évaluation :
les quatre titres là et dans l'ordre, chaque point des deux premières parties
marqué, aucune marque sous les écarts, chaque marque et chaque source du bloc
valide — sinon `0`, une ligne `agent.match_structure` dit pourquoi (les
raisons, jamais le texte — le journal ne les garde pas), et la réponse est
servie quand même ; une évaluation coupée par `max_tokens` est dite à part
(`agent.match_truncated`). **Un point est un item de liste** (`-`, `*`, `+`,
`1.`) : c'est ce que le prompt demande et la seule chose contrôlée — une
phrase sans puce (« Rien à signaler. », une partie vide dite d'une ligne)
n'est pas un point et n'est pas contrôlée. L'échange est journalisé
`kind = 'match'` avec l'annonce entière en `question` — **les annonces
collées sont conservées comme les questions**, entières, et la zone le dit ;
dans l'historique des tours suivants, un repère localisé remplace l'annonce
(huit mille caractères ne se rejouent pas six fois), la réponse reste, et une
question qui y revient s'entend répondre que l'annonce n'est plus disponible.
Un refus préalable (débit, plafond, indisponibilité) ramène à la zone avec le
message, le texte collé intact. Sans JavaScript, la sixième puce reste
désactivée.

**Le protocole** (`POST /api/chat` `{question, lang}` et `POST /api/match`
`{ad, lang}`, AD-16 — même mécanique, `src/app/_lib/stream-route.ts`) : un
refus préalable est un JSON `{ok: false, reason}` — `invalid_input` 400 (corps
de plus de 8 Kio pour une question, 48 Kio pour une annonce — des octets
UTF-8, `Content-Length` annoncé ou texte mesuré — et texte mal formé, une
paire de substitution coupée, compris),
`no_visitor` 401, `rate_limited` 429, `cap_reached` 503, `model_unavailable`
503 (aussi quand l'agent lève hors de son contrat) —, un flux ouvert est du
`text/event-stream` avec `delta {text}`, `done {sources, exchangeId}` et
`error {reason}`. Tant que l'agent n'a rien produit — la réflexion du modèle
précède son premier mot —, la route envoie un commentaire SSE `: ping` toutes
les dix secondes ; le navigateur, lui, remet son délai de trente secondes à
zéro sur tout octet reçu. Chaque raison a son message dans `messages/` ;
`cap_reached` et `model_unavailable` renvoient au contact direct de la page.
Le contrat vit une fois, dans `src/app/_lib/chat-contract.ts`, lu par les
routes et par le composant client.

**Ce que coûte une question** : les ordres de grandeur seulement — **la table
datée de [`src/agent/pricing.ts`](./src/agent/pricing.ts) fait foi**, pas ce
paragraphe. Avec le noyau réel (≈ 15 000 jetons, mesuré le 2026-09-17, en
cache après le premier appel), quelques milliers de jetons variables et
quelques centaines de sortie, une question coûte de l'ordre de quelques
centimes — le premier appel, qui écrit le cache, en coûte une dizaine ; la
réservation, elle, suppose le pire cas (tout en écriture de cache, réponse au
plus long) et vaut deux à trois fois le coût d'un appel en cache. Soit de
l'ordre de la centaine de questions par mois sous le plafond de 5 USD. Changer
un prix, un seuil ou le modèle est une décision, pas un réglage.

**Variables** : `ANTHROPIC_API_KEY` (requise, serveur seulement) et
`ANTHROPIC_BASE_URL` (optionnelle, **tests et simulateur seulement** — vide
en production, le SDK vise alors l'API réelle ; présente, le démarrage le dit
en `warn`, `config.model_base_url`, avec l'hôte visé). Le simulateur
(`tests/e2e/model-stub/server.mjs`) parle le format SSE de `/v1/messages`,
vérifie ce que la passerelle envoie, et joue des scénarios choisis par le
dernier message : une réponse ordinaire au bloc `<sources>` fragmenté et aux
sources valides, `[invalide]` avec une source invalide en plus, `[erreur]` qui
coupe après deux deltas, `[lent]` qui attend douze secondes avant le premier
delta, `[espace]` qui espace ses deltas, `[plafond]` qui déclare un `usage` de
plus de 5 USD — ce dernier tourne en dernier et isolé (`chromium-plafond`,
sans reprise), puisqu'après lui plus rien ne passe — et, quand le message
porte `<annonce>`, une évaluation en quatre parties dans la langue des règles,
marques fragmentées et bloc compris (`[invalide]` dans l'annonce y glisse une
marque invalide).

**Essayer à la main, sur le contenu réel, sans rien payer** : lancer le
simulateur dans un terminal (`npm run stub`), pointer `ANTHROPIC_BASE_URL`
dessus dans `.env.local` (`http://127.0.0.1:3901`), lancer `npm run dev`,
poser une question dans le champ libre — ou coller une annonce fictive par la
sixième puce. Le démarrage journalise la taille du
noyau (`knowledge.ready`) et rappelle que la passerelle vise le simulateur
(`config.model_base_url`) ; `usage.db` montre l'échange. Retirer la variable
ensuite : avec elle, aucune question n'atteint l'API réelle.

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
