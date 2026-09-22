Ce site est ma candidature, mais c'est aussi ma démonstration : il a été spécifié, conçu et construit selon la méthode que je revendique — le développement piloté par des agents IA, cadré par des documents écrits avant le code. Cette page décrit ce qui tourne réellement derrière l'adresse que vous avez ouverte. [Le code est public](https://github.com/JrmNvll/cv-site).

## Une seule source de vérité

Tout ce que le site affiche et tout ce que l'assistant affirme provient de deux fichiers que je maintiens à la main : un fichier cv.yaml (le CV, structuré, bilingue) et une base de questions-réponses en Markdown — plus de deux cents questions qu'un recruteur peut poser, avec mes réponses. Ces fichiers ne sont **pas** dans le dépôt de code : ils vivent dans un répertoire privé que l'application lit au démarrage, après en avoir validé le format. Un fichier malformé empêche le site de démarrer ; il ne produit jamais une réponse approximative.

## Un assistant qui ne peut pas inventer

L'assistant ne « connaît » rien de moi en dehors de ces deux fichiers. À chaque question, le serveur — du code ordinaire, sans IA — sélectionne les douze entrées les plus proches par recherche lexicale (BM25+), y ajoute un noyau toujours présent (le CV, les règles de comportement, la liste des sujets que je ne traite pas), l'historique de la conversation, puis envoie le tout au modèle (Claude Opus 5) avec une consigne stricte : répondre uniquement à partir de ces sources, et **citer** pour chaque affirmation l'identifiant de l'entrée utilisée.

Ces citations sont invisibles pour vous, mais elles sont contrôlées et journalisées. Une affirmation sans source est un échec de test. Hors périmètre — une question qui ne concerne pas mon parcours, une tentative de faire dévier l'assistant — il refuse avec une formulation fixe plutôt que d'improviser. Une suite de tests adverses (questions pièges, sujets privés, tentatives de manipulation, annonces à évaluer) est rejouée contre l'API réelle avant chaque mise en production.

Le même mécanisme sert l'évaluation d'une annonce : vous collez le texte d'une offre, et l'assistant dit ce qui correspond, ce qui est transférable et ce qui n'est pas documenté dans mon dossier — chaque point cité, sans note ni verdict. Ce que le dossier ne dit pas est présenté comme tel, jamais comme une incapacité.

## Des garde-fous comptés en dollars

L'assistant coûte de l'argent à chaque question. Le budget est plafonné à 5 dollars par mois, et ce plafond est **appliqué par le code**, pas surveillé après coup : chaque appel réserve son coût estimé avant de partir, enregistre le coût réel au retour, et la passerelle refuse tout appel qui ferait dépasser le cumul du mois. S'y ajoutent une limitation de débit par visiteur, par adresse et pour le site entier, une taille d'entrée bornée, et une clé d'API qui ne quitte jamais le serveur. Le cache de prompt réduit le coût des questions successives d'une même conversation ; la suite de tests adverses vérifie qu'il fonctionne.

## Ce que le site conserve

Je joue franc jeu : ce site conserve, sans limite de durée, les questions posées, les réponses données et les annonces collées, avec une session par visite (adresse IP, navigateur, provenance, langue) et un identifiant de visiteur déposé en cookie. Cela me permet de savoir ce qu'on me demande, et de reconnaître une visite qui revient. Le détail figure dans les [mentions légales](/fr/mentions). L'assistant ne le cache pas non plus : demandez-lui.

## La technique, en une ligne par choix

- **Un seul processus** : Next.js 16 sur Node.js 24, en mode standalone, sur un serveur Windows que j'administre moi-même.
- **Pas de base de données à administrer** : SQLite, intégré à Node, un fichier.
- **Caddy** en façade : HTTPS automatique, en-tête noindex sur chaque réponse, protection de l'espace d'administration — le site n'est pas conçu pour être indexé.
- **Bilingue** par préfixe d'URL, avec un corpus par langue.
- **Contenu et code séparés** : le code est public, le contenu est privé, et le format qui les relie est un contrat validé au démarrage.

## La méthode

Ce site a suivi la méthode BMAD (Breakthrough Method for Agile AI-Driven Development), celle que j'utilise en projet : un brief produit (le problème, pour qui, les critères de succès), puis un squelette d'architecture qui fixe les invariants — dix-sept décisions numérotées, chacune avec ce qu'elle empêche — puis un découpage en stories réalisées une par une par des agents, chacune spécifiée avec ses critères d'acceptation avant d'être développée. Le squelette a été soumis à quatre relectures indépendantes (grille de cohérence, vérification des versions sur le web, attaque adversaire, réconciliation avec le brief) avant d'être figé ; la première version comportait un trou critique et une douzaine de failles que ces relectures ont fermés.

C'est exactement ainsi que je travaille en entreprise. La différence, ici, c'est que vous pouvez le vérifier.
