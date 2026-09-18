Ce site est un curriculum vitæ personnel : il ne vend rien, ne collecte rien à votre insu et n'est pas fait pour être trouvé par un moteur de recherche. Cette page dit qui le publie, ce qu'il conserve de votre visite et pourquoi, ce qu'il transmet, et comment exercer vos droits. La technique est décrite dans [Comment ce site est construit](/fr/comment).

Dernière mise à jour : 18 septembre 2026.

## Qui publie ce site

Ce site est publié par {name}, à titre personnel, dans le cadre de sa recherche d'emploi. Il n'a pas d'autre objet que de présenter son parcours et de répondre aux questions d'un recruteur. Pour le joindre, voir la rubrique « Contact » en bas de cette page ; aucune adresse postale n'est publiée.

## Hébergement

Le site tourne sur un serveur privé virtuel loué chez {hebergeur}, sous Windows Server 2025, administré par l'éditeur lui-même. Le nom de domaine est géré chez Cloudflare ; le certificat HTTPS est délivré par Let's Encrypt. Le journal des visites décrit ci-dessous est conservé sur ce serveur ; il est sauvegardé automatiquement chaque nuit, et ces sauvegardes sont conservées quatorze jours sur le serveur ; l'éditeur en fait en outre des copies manuelles. Le serveur mandataire qui reçoit les connexions (Caddy) tient un journal d'accès technique — adresse IP, navigateur, URL demandée, horodatage — tenu par tranches d'un mégaoctet ; chaque tranche archivée est effacée automatiquement après quatorze jours au plus.

## Cookies

Le site dépose deux cookies techniques, et aucun autre :

- **cv_visitor** — un identifiant aléatoire de visiteur, conservé 400 jours, qui permet de reconnaître une visite qui revient ;
- **cv_session** — un identifiant de session, effacé à la fermeture du navigateur, qui regroupe les questions posées au cours d'une même visite ; après 30 minutes d'inactivité, une nouvelle session commence.

Ils ne servent qu'au journal des visites. Ils ne sont lisibles par aucun script et ne sont partagés avec personne. Aucun cookie tiers, aucun cookie publicitaire, aucune mesure d'audience. Il n'y a pas de bannière de consentement, et voici pourquoi : la loi suisse sur la protection des données (LPD) impose d'informer — c'est l'objet de cette page — et ces deux cookies, nécessaires au journal, reposent sur l'intérêt légitime de l'éditeur, non sur un consentement.

## Ce que le site conserve, et pourquoi

Chaque visite est inscrite dans un journal tenu sur le serveur, **sans limite de durée** :

- l'adresse IP, le navigateur (chaîne User-Agent), la page de provenance (sans ses paramètres) et la langue choisie ;
- les horodatages de début et de dernière activité de chaque session ;
- les questions posées à l'assistant — y compris les questions préparées que vous cliquez —, les réponses données, et les annonces d'emploi collées pour évaluation, entières ;
- le coût de chaque appel au modèle de langage ;
- les annotations de l'éditeur : un nom ou une note qu'il pose sur un visiteur, une étiquette qu'il pose sur une adresse — jamais supprimées non plus ; les retirer y écrit une valeur vide.

Pourquoi : savoir ce qu'on demande à l'éditeur, reconnaître une visite qui revient, et tenir la dépense de l'assistant sous son plafond mensuel. L'application n'efface rien d'elle-même et n'agrège rien à des fins commerciales ; rien n'est transmis à un tiers en dehors de ce que la rubrique suivante décrit. Seul l'éditeur consulte ce journal, par un espace d'administration protégé par mot de passe.

## Ce qui est transmis à Anthropic

L'assistant repose sur un modèle de langage fourni par Anthropic (Claude). Pour produire une réponse, le serveur envoie à l'API d'Anthropic : votre question — ou l'annonce que vous avez collée —, les échanges précédents de la même conversation, et le dossier de l'éditeur : son CV et les extraits de ses réponses préparées qui se rapportent à votre demande. Ni votre adresse IP, ni vos cookies, ni votre navigateur ne font partie de cet envoi.

Anthropic est établie aux États-Unis : ces données y sont transmises. Ce transfert repose sur les conditions commerciales d'Anthropic pour son API, qui excluent l'utilisation des données pour entraîner ses modèles et en limitent la durée de conservation. Le traitement lui-même repose sur l'intérêt légitime de l'éditeur : savoir ce qu'on lui demande et reconnaître une visite qui revient. Le droit applicable est la loi fédérale suisse sur la protection des données (LPD) ; l'autorité de surveillance est le Préposé fédéral à la protection des données et à la transparence (PFPDT).

## Aucun traceur

Aucun script de mesure d'audience, aucun réseau social embarqué, aucune police ni ressource chargée depuis un service tiers : votre navigateur ne parle qu'à ce site. Les liens vers LinkedIn et GitHub sont des liens ordinaires, qui ne chargent rien tant que vous ne cliquez pas.

## Vos droits

Vous pouvez demander l'accès aux données qui vous concernent — les sessions et les questions liées à votre visite —, leur rectification ou leur effacement. La demande se fait par courriel, à l'adresse de la rubrique « Contact » ; votre adresse IP et la date approximative de votre visite suffisent à les retrouver — l'identifiant du cookie, que vous ne pouvez pas lire, n'est pas nécessaire. L'application n'efface rien d'elle-même ; sur demande, l'éditeur efface à la main les données liées à votre visite et consigne cet effacement — il porte sur le journal des visites ; les sauvegardes et les tranches archivées du journal d'accès technique expirent d'elles-mêmes sous quatorze jours. Sans JavaScript, le bouton du courriel n'apparaît pas : les profils LinkedIn et GitHub de la page CV restent alors le moyen de le joindre.

## Site non indexé

Chaque page porte une consigne de non-indexation (noindex), répétée dans un en-tête HTTP de chaque réponse, et le fichier robots.txt interdit tout parcours aux robots. Ce site est fait pour être ouvert depuis une candidature, pas trouvé par hasard.

## Contact

Par courriel : le bouton ci-dessous affiche l'adresse. Il demande JavaScript, pour que l'adresse ne figure pas dans le code de la page et ne soit pas moissonnée. Sans JavaScript, l'éditeur reste joignable par les profils LinkedIn et GitHub de la [page CV](/fr#contact).
