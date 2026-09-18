# Les décisions d'architecture — AD-1 à AD-17

Le code de ce dépôt cite ses décisions par leur numéro (`AD-8`, `AD-14`…). Elles viennent du
**squelette d'architecture** du projet — un document figé avant la première ligne de code, relu
quatre fois, amendé au fil des stories — qui vit dans le dépôt privé du contenu, avec le brief
et les spécifications. Cette page en donne la lecture publique : le titre et la règle de chacune,
en une ligne, pour qu'un relecteur du code puisse résoudre chaque référence sans le squelette.
Le pourquoi détaillé — ce que chaque décision empêche — reste dans le squelette ; la page
« Comment ce site est construit » du site (`/fr/comment`) raconte la méthode.

- **AD-1 — Un seul processus Next.js 16 sur Node 24 LTS.** Pages, API de l'agent et espace
  d'administration vivent dans la même application (App Router, TypeScript `strict`), construite
  en `output: 'standalone'` et lancée par `node server.js` ; aucun autre service applicatif.
- **AD-2 — Le contenu est un contrat externe, jamais dans le dépôt de code.** Le code lit
  `CONTENT_DIR` (`cv.yaml`, `qa.fr.md`, `qa.en.md` optionnel, `assets/`, `tests/adversarial.yaml`),
  validé par un schéma Zod au démarrage ; un contenu invalide arrête le processus ; le dépôt public
  ne porte qu'une fixture fictive, sur laquelle tournent tous les tests.
- **AD-3 — Ancrage par noyau fixe et récupération lexicale, orchestré par `agent`.** Le contexte
  d'une question est exactement : le noyau monolingue (projection `agent` du CV, index des titres,
  entrées `sys-*`, consignes des entrées `PRIVÉ` sans leur corps), les douze entrées les mieux
  classées par BM25+ sur le texte débalisé, les six derniers échanges de la session, puis la
  question ou l'annonce — sans aucun appel au modèle pour choisir ; seuls le bloc système et
  `<dossier>` font foi.
- **AD-4 — Citation obligatoire, refus explicite, consignes globales.** Chaque réponse fondée sur
  le dossier se termine par un bloc `<sources>` d'identifiants (`qa:<id>`, `cv:<chemin>`) valides
  — existants, non vides, jamais `PRIVÉ` ; hors périmètre, refus selon `sys-*` sans bloc ; entrée
  `PRIVÉ` demandée, renvoi selon sa consigne ; l'agent parle de la personne à la troisième
  personne, ne nie jamais que les questions sont conservées, renvoie vers la page « Mentions
  légales & confidentialité », ne donne jamais le téléphone.
- **AD-5 — Une langue, un corpus, une projection, une réponse.** La langue est le préfixe d'URL
  (`/fr`, `/en`, next-intl) ; elle choisit le corpus indexé, la projection injectée et la langue
  imposée au modèle ; `qa.en.md` porte les mêmes identifiants que `qa.fr.md` ; s'il manque, `/en`
  s'ancre sur le français avec consigne de répondre en anglais, repli journalisé.
- **AD-6 — Une seule passerelle vers le modèle, plafond dur à 5 USD par mois.** Tout appel passe
  par `agent/gateway` : cumul du mois calculé sur `exchange.cost_micro_usd` (réservations
  comprises), refus `cap_reached` si cumul + réservation dépasse 5 USD, insertion `pending` avant
  l'appel dans la même transaction, finalisation avec les compteurs réels et une table de prix
  datée ; modèle et `max_tokens` imposés, entrée bornée ; trois fenêtres de débit en mémoire
  (visiteur, adresse, site) ; clé d'API en variable d'environnement, jamais au navigateur.
- **AD-7 — Le journal n'a qu'un propriétaire, n'efface rien, ne dénormalise rien.** Seul
  `journal` ouvre `usage.db` (`node:sqlite`, dans `DATA_DIR`) : entités `visitor`, `session`,
  `exchange`, `ip_label` ; écritures en insertion plus une liste fermée de colonnes modifiables ;
  aucune suppression, aucune purge, aucune table d'agrégat — statistiques et cumul se calculent à
  la lecture ; une seule fonction crée ou prolonge une session. L'**application** n'efface donc
  rien ; un droit à l'effacement s'exerce hors d'elle : sur demande, l'éditeur efface à la main
  les données liées à la visite concernée et consigne cet effacement — c'est ce que déclare la
  page « Mentions légales & confidentialité » (story 9).
- **AD-8 — Deux projections de `cv.yaml`, par liste blanche.** `display` pour la page, `agent`
  pour le modèle, champ par champ ; un champ non listé ne sort pas ; courriel, téléphone et
  coordonnées d'une référence ne sont jamais dans le HTML servi — une route sur geste explicite,
  insertion côté client ; adresse postale, état civil, signataires et chemins de fichiers ne
  sortent d'aucune projection ; un test cherche chaque valeur exclue dans ce qui est servi.
- **AD-9 — Secrets et configuration par l'environnement uniquement.** `ANTHROPIC_API_KEY`,
  `CONTENT_DIR`, `DATA_DIR`, `NEXT_PUBLIC_SITE_URL`, `HOSTNAME`, `PORT`, `ADMIN_DEV` — et
  `ANTHROPIC_BASE_URL`, réservée aux tests, signalée si posée — validés au démarrage par
  `src/env.ts` ; le Caddyfile est versionné avec des substitutions d'environnement ;
  `.env.example` sans valeurs, `.env*` ignorés.
- **AD-10 — Le proxy est la seule porte ; l'admin vit hors localisation et sous sa seule
  protection.** Node n'écoute que sur `127.0.0.1` ; Caddy termine TLS et protège `/admin*` par
  `basic_auth` ; l'admin vit hors `[locale]`, en français, hors du routage next-intl ; toute
  mutation est un formulaire HTML vers une route handler sous `/admin/api/*` — aucune Server
  Action — qui exige une origine identique ; en développement, `/admin` n'existe que si
  `ADMIN_DEV=1`.
- **AD-11 — Non indexable, sur chaque réponse.** Caddy ajoute `X-Robots-Tag: noindex, nofollow`
  à toutes les réponses ; l'application répète `<meta name="robots" content="noindex, nofollow">`
  sur chaque page et sert un `robots.txt` qui interdit tout — redondance voulue.
- **AD-12 — « Zéro invention » est prouvé par une suite adverse.** Le jeu de questions vit dans le
  dépôt privé (`CONTENT_DIR/tests/adversarial.yaml`), le dépôt public ne porte que le runner et un
  mini-jeu sur la fixture ; rejouée à la demande contre l'API réelle, dans les deux langues : toute
  réponse couverte cite des sources valides, aucun refus n'en porte, aucune entrée `PRIVÉ` n'est
  citée, le téléphone n'apparaît jamais, le cache de prompt est lu au second appel ; aucune mise
  en production sans suite verte.
- **AD-13 — Déploiement reproductible sur le VPS Windows.** Deux services Windows, Caddy et
  l'application (`node server.js` du build autonome, via NSSM) ; un script fait tout : `git pull`,
  `npm ci`, `npm run build`, copie de `.next/standalone` avec `public/` et `.next/static`,
  redémarrage ; deux environnements seulement, développement et production ; sauvegarde
  quotidienne de `DATA_DIR` hors du serveur.
- **AD-14 — Un visiteur, une session : cookies posés par `proxy.ts`, session tenue par
  `journal`.** Sur chaque requête de document, le proxy lit ou pose `cv_visitor` (ULID, 400 jours)
  et `cv_session` (ULID, cookie de session, renouvelé après 30 minutes d'inactivité), `HttpOnly`,
  `Secure`, `SameSite=Lax` ; la racine du site et chaque route d'un geste réel appellent
  `touchSession()`, qui crée la session à sa première apparition (adresse, navigateur, provenance,
  langue) et prolonge ensuite ; les cookies ne sont pas signés — étiquette du journal, pas
  autorisation ; le journal observe la visite sans la conditionner ; l'admin ne se journalise
  pas.
- **AD-15 — Une seule source pour l'adresse du client.** Caddy pose `X-Client-IP` depuis son
  `client_ip` (proxy Cloudflare de confiance ou DNS seul, selon la configuration), en écrasant
  toute valeur entrante ; `X-Forwarded-For` n'est jamais lu ; une seule fonction
  (`src/lib/client-ip.ts`) rend l'adresse, `journal` et le limiteur la reçoivent en paramètre.
- **AD-16 — Protocole de réponse de `/api/chat` et `/api/match`.** Refus préalable en JSON
  `{ok: false, reason}` avec un statut par raison (`invalid_input` 400, `no_visitor` 401,
  `rate_limited` 429, `cap_reached` 503, `model_unavailable` 503) ; flux `text/event-stream` avec
  `delta`, `done {sources, exchangeId}`, `error {reason}` et un commentaire `: ping` toutes les dix
  secondes tant que rien n'est produit ; chaque raison a son message localisé ; le bloc `<sources>`
  est retenu côté serveur, le contrôle des citations est a posteriori et journalisé.
- **AD-17 — Posture de l'évaluation d'adéquation.** `agent.match()` impose une structure fixe et
  localisée — points forts, compétences transférables, écarts, conclusion — dans le même bloc
  système que les questions ; chaque point des deux premières parties porte une marque `[qa:…]` ou
  `[cv:…]`, retirée côté serveur ; les écarts sont « non documenté dans le dossier », jamais une
  incapacité ; aucune note, aucun pourcentage, aucun verdict ; l'annonce (8 000 caractères au
  plus) est journalisée entière et rejouée par un repère dans les tours suivants.
