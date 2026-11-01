# Indexation de la veille dans Algolia

Le site génère `/algolia/curated-links.json` à chaque build à partir des curated links publiés dans Prismic. Le fichier contient un tableau JSON, avec un enregistrement par traduction publiée (fr/en), sans doublons liés aux traductions de repli. Les brouillons ne sont pas exportés. `objectID` est stable et compatible avec le script existant `.algolia-wizard/ingest.ts`.

## Connecteur JSON

Chaque enregistrement contient les données nécessaires aux cartes de la liste : titre, résumé Markdown, URL originale, permalien (`path`), dates, format, langues, crédit, `image` et `siteIcon` (objets avec `url`, `alt`, et dimensions lorsqu’elles sont disponibles). Les médias absents valent `null`. Les URLs des médias sont celles de Prismic ; les variantes optimisées générées par Astro ne sont pas exportées.

`topics` conserve les noms pour la recherche et les facettes ; `topicDetails` contient les objets complets (`id`, `uid`, `name`, `description`) pour reconstruire les liens de sujets. `discoveredVia` conserve le nom pour la recherche ; `source` contient la source complète, avec son URL et son éventuelle `icon`, utilisée en repli lorsque `siteIcon` manque. Le monogramme et le domaine se déduisent de `url`, comme dans les cartes actuelles. `alternatePaths` contient les permaliens des traductions disponibles.

Après déploiement du site :

1. Dans Algolia, ouvrir **Data sources / Connectors** et choisir le connecteur **JSON**.
2. Utiliser l’URL `https://sebastien.rigaux.be/algolia/curated-links.json`, en HTTP GET, sans authentification. Le tableau des enregistrements est à la racine.
3. Sélectionner `objectID` comme identifiant unique.
4. Choisir l’index `watchlink` comme destination.
5. Lancer un premier import, puis programmer les suivants à la fréquence souhaitée.

Configurer les paramètres de l’index :

```json
{
  "searchableAttributes": ["title", "summary", "topics", "credit", "discoveredVia"],
  "attributesForFaceting": ["locale", "format", "topics"],
  "attributesToSnippet": ["summary:20"]
}
```

La recherche du site filtre sur `locale` et `format` : ces facettes sont nécessaires.

## Actualisation et suppressions

Le flux est un instantané statique : publication Prismic → reconstruction et déploiement du site → prochaine exécution du connecteur. Algolia ne lit pas Prismic en direct. Aucun secret Algolia d’écriture n’est nécessaire dans le site pour ce fonctionnement.

Vérifier le comportement de suppression proposé par la tâche Algolia : une simple mise à jour des objets ne supprime pas les liens dépubliés, qui disparaissent du JSON. Utiliser une synchronisation complète avec suppression des objets absents si elle est disponible, ou prévoir une réconciliation séparée. Ne pas faire tourner simultanément le script d’ingestion manuel et le connecteur comme deux sources concurrentes.

Documentation : https://www.algolia.com/developers/code-exchange/json-connector
