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

## Phase 2, séparée

Rapprocher le corpus et le manifeste du catalogue Prismic actualisé. Regrouper les traductions d’une ressource et proposer un diff révisable des tags, avec justification. Tooling et Releases exigent une nouvelle lecture du contenu, sans remplacement générique. Appliquer seulement les choix validés, puis réaffecter les relations et associations avant toute fusion ou suppression. Préserver ou rediriger les anciennes URLs, reconstruire le site et réindexer Algolia après cette migration.
