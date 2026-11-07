# Tags de veille — livraison et historique

Le corpus éditorial [tech-watch-tags.v1.json](./tech-watch-tags.v1.json) est la référence indépendante de Prismic : 168 concepts, dont 166 actifs et les deux anciens sujets Tooling et Releases retirés de la navigation. Les références aux ressources justifient le catalogue ; elles ne constituent pas des attributions de tags aux fiches.

Le manifeste [tech-watch-tags.prismic.v1.json](./tech-watch-tags.prismic.v1.json) rapproche chaque clé stable des documents FR/EN créés ou conservés. Son statut indique si la release est seulement préparée ou publiée. Les 67 identifiants français historiques et leurs UIDs sont conservés. Seuls les 63 sujets utilisés avant la migration portent `legacy_page: true` ; les autres pages nécessitent trois ressources distinctes et une traduction publiée.

## Ordre d’activation

1. Valider le corpus avec `node tools/tags/validate-corpus.mjs --ready`.
2. Synchroniser les modèles via la CLI Prismic et préparer le catalogue dans une release dédiée, sans modifier les documents `curated_link`.
3. Vérifier les champs et associations de la release, puis la publier depuis la carte Prismic ou le tableau de bord.
4. Vérifier les 336 documents publiés avec `node tools/tags/verify-published-catalog.mjs`. Construire et vérifier le site contre ce catalogue, puis livrer le site et le bot. Vérifier les pages FR/EN, les anciens chemins, les tags retirés, les descriptions et les liens associés.
5. Exécuter la [synchronisation Algolia](./algolia-curated-links.md) après le déploiement du nouvel export, hors import concurrent du connecteur JSON.
6. Vérifier un nouveau lien réel dans Telegram, sa publication bilingue et sa recherche. Les fiches historiques ne sont pas reclassées pendant cette phase.

## Reprise et concurrence du bot

Les anciens brouillons sans `newTags` restent lisibles. Les nouvelles propositions comportent au plus cinq tags au total, dont deux créations. Chaque création doit être acceptée ; une correction de son contenu invalide son acceptation. Les détails bilingues et le SEO sont envoyés dans un message séparé par tag, dont les réponses restent liées à la version de la proposition.

Sous le verrou de publication, le bot relit le catalogue et contrôle aussi les créations déjà journalisées : une publication acceptée peut ne pas encore être visible dans la Content API. Les écritures Prismic restent journalisées ; une réponse perdue exige une réconciliation avant reprise. Le catalogue en cache est invalidé après publication.

## Résolution des tags en deux appels

La rédaction reçoit seulement une liste dédupliquée des noms anglais des tags actifs comme repère de vocabulaire et de granularité, sans identifiants, alias, descriptions ni tags du brouillon précédent. Si la traduction anglaise manque, le nom de référence est conservé. Cette liste ne constitue pas une preuve de pertinence et n’impose aucun choix. Elle extrait au maximum cinq concepts, leurs termes de recherche et un extrait justificatif. Le bot rejette les extraits qui ne figurent pas dans la source ou les consignes utilisateur.

L’index Algolia privé `watchtags` contient un enregistrement par concept actif, y compris ceux qui n’ont encore aucun lien : identifiant Prismic français, UID, nom, alias bilingues, description, catégorie et highlight. Il est distinct de l’index public `watchlink`. Une clé limitée à `watchtags` avec `search`, `addObject`, `deleteObject`, `settings` et `editSettings` alimente le script et le secret Worker `ALGOLIA_TAGS_API_KEY`. Aucun secret de cet index n’est envoyé au navigateur.

```sh
pnpm --filter website-astro exec node --env-file=.env scripts/sync-watch-tag-catalog.mjs
pnpm --filter website-astro exec node --env-file=.env scripts/sync-watch-tag-catalog.mjs --apply
```

Avant la recherche, le bot synchronise le catalogue si son empreinte a changé, puis attend son indexation. Il cherche les noms et équivalents des concepts et transmet au second appel au plus huit candidats par concept, avec leurs descriptions. Les correspondances exactes du catalogue Prismic complètent les résultats pour protéger les identités récentes ; les résultats inconnus ou retirés sont exclus. Le second appel choisit parmi les candidats du concept, écarte un concept ou prépare une création bilingue. Les contrôles de doublons portent toujours sur l’intégralité du catalogue Prismic. Une panne de recherche interrompt la génération ; elle ne doit jamais être interprétée comme une absence de tag existant.

L’ancienne génération monolithique a proposé à tort Authentication pour un article sur l’hydratation React. Le changement de niveau de raisonnement seul n’a pas suffi selon le test utilisateur ; la séparation des tâches et la recherche dédiée remplacent cette approche.

## Complément des alias — 7 novembre 2026

La release `au8zNhIAAAJSlsHS` complète les formes développées de 18 tags (36 documents FR/EN), dont SSR, SSG, CSS, AI, RAG et WCAG. Le corpus JSON contient ces ajouts ; leur publication Prismic et leur synchronisation dans les 166 enregistrements de `watchtags` sont vérifiées. Aucun lien historique n’est modifié. Le cache du bot a été invalidé et `watchtags` synchronisé après publication. Les noms anglais identiques au nom principal ne sont plus ajoutés comme alias de recherche.

Le nouveau test réel a atteint la revue avec Hydration et SSR, sans erreur de doublon. Il a également proposé deux créations trop spécifiques : les consignes excluent désormais les fonctions, props, options et recettes propres à un article des concepts autonomes. Le test suivant a encore proposé Rendu déterministe et React Suspense. Le commit `3a57bf7` transmet désormais le titre et le résumé au second appel, avec une comparaison des recouvrements et de la centralité des sujets. Cette dernière évolution reste à vérifier sur une nouvelle instance réelle ; le brouillon `u428355146` conserve les propositions antérieures et ne constitue pas une preuve pour ce correctif.

## État de validation au 7 novembre 2026

- Catalogue publié : 336 documents vérifiés contre le corpus, avec identifiants, traductions, alias et associations.
- Algolia : 166 concepts actifs dans `watchtags` ; 843 traductions publiées dans `watchlink`. Après le rebuild Prismic, l’export contient l’alias Server-side rendering sur 12 fiches FR/EN et a été réindexé.
- Site : build et déploiement GitHub Actions `42381758086` terminés avec succès.
- Bot : 186 tests Vitest et 6 tests de scripts réussis avant le dernier ajout de contexte ; les 15 tests services/workflow concernés par cet ajout passent, ainsi que TypeScript, ESLint et Prettier.
- Version Worker du dernier correctif : `fb2eb8ea-755b-45e4-a945-75e1d4f20cf5`.
- Validation encore ouverte : sélection autonome sur une nouvelle instance Telegram utilisant cette version. Ne pas publier le doublon de test et ne pas considérer les assertions de prompts ou tests simulés comme une preuve de pertinence éditoriale réelle.

## Phase 2, séparée

Rapprocher le corpus et le manifeste du catalogue Prismic actualisé. Regrouper les traductions d’une ressource et proposer un diff révisable des tags, avec justification. Tooling et Releases exigent une nouvelle lecture du contenu, sans remplacement générique. Appliquer seulement les choix validés, puis réaffecter les relations et associations avant toute fusion ou suppression. Préserver ou rediriger les anciennes URLs, reconstruire le site et réindexer Algolia après cette migration.
