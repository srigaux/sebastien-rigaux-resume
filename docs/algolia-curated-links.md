# Indexation de la veille dans Algolia

Le site génère `/algolia/curated-links.json` à chaque build à partir des curated links publiés dans Prismic. Le fichier contient un tableau JSON, avec un enregistrement par traduction publiée (fr/en), sans doublons liés aux traductions de repli. Les brouillons ne sont pas exportés. `objectID` est stable et compatible avec le script existant `.algolia-wizard/ingest.ts`.

## Connecteur JSON

Chaque enregistrement contient les données nécessaires aux cartes de la liste : titre, résumé Markdown, URL originale, permalien (`path`), dates, format, langues, crédit, `image` et `siteIcon` (objets avec `url`, `alt`, et dimensions lorsqu’elles sont disponibles). Les médias absents valent `null`. Les URLs des médias sont celles de Prismic ; les variantes optimisées générées par Astro ne sont pas exportées.

`topics` conserve les noms pour la recherche et les facettes ; `topicDetails` contient les objets complets (`id`, `uid`, `name`, `description`) pour reconstruire les liens de sujets. `discoveredVia` conserve le nom pour la recherche ; `source` contient la source complète, avec son URL et son éventuelle `icon`, utilisée en repli lorsque `siteIcon` manque. Le monogramme et le domaine se déduisent de `url`, comme dans les cartes actuelles. `alternatePaths` contient les permaliens des traductions disponibles.

Après déploiement du site :

1. Dans Algolia, ouvrir **Data sources / Connectors** et choisir le connecteur **JSON**.
2. Utiliser l’URL `https://sebastien.rigaux.be/algolia/curated-links.json`, en HTTP GET, sans authentification. Le tableau des enregistrements est à la racine.
3. Sélectionner `id` comme identifiant unique (identifiant Prismic propre à chaque traduction).
4. Choisir l’index `watchlink` comme destination.
5. Lancer un premier import, puis programmer les suivants à la fréquence souhaitée.

Configurer les paramètres de l’index :

```json
{
  "searchableAttributes": ["title", "summary", "topics", "credit", "discoveredVia"],
  "attributesForFaceting": ["locale", "format", "topics"],
  "attributeForDistinct": "url",
  "distinct": 1,
  "attributesToSnippet": ["summary:20"]
}
```

La recherche du site inclut le français et l’anglais et filtre sur `format` : les facettes `locale` et `format` sont nécessaires.

## Dédupliquer les traductions

Dans **Configuration → Deduplication and grouping** de l’index `watchlink`, définir **Attribute for distinct** sur `url`. Les traductions conservent leurs identifiants uniques, mais celles qui partagent exactement la même URL originale forment un groupe. Ce réglage utilise un champ déjà indexé et ne nécessite pas de réimport.

Les requêtes du site utilisent `distinct: 1` pour afficher uniquement la traduction la plus pertinente de chaque groupe, avec la pagination et le nombre de résultats calculés par Algolia. Sans `attributeForDistinct` dans l’index, Algolia ignore `distinct`.

Les deux requêtes (résultats et compteurs de formats) ajoutent `optionalFilters: ["locale:fr"]` ou `["locale:en"]` selon la langue de la page. Cette préférence intervient dans le classement avant que `distinct` choisisse la traduction d’un groupe, sans exclure l’autre langue. Elle nécessite le critère `filters` dans la formule de classement (présent par défaut). Les critères de pertinence qui le précèdent, notamment les fautes de frappe et le nombre de mots correspondants, restent prioritaires : ce n’est pas une obligation absolue d’afficher la langue de la page.

La facette `format` est demandée avec `facetingAfterDistinct: true`, y compris pour les compteurs des autres formats : elle compte les articles, sans compter deux fois leurs traductions. Les traductions d’un même article doivent conserver le même `format`. Ce paramètre ne doit pas être étendu à une facette dont les valeurs diffèrent entre traductions, comme `locale`.

Références : [distinct](https://www.algolia.com/doc/api-reference/api-parameters/distinct), [attributeForDistinct](https://www.algolia.com/doc/api-reference/api-parameters/attributeForDistinct).

## Actualisation et suppressions

Le flux est un instantané statique : publication Prismic → reconstruction et déploiement du site → prochaine exécution du connecteur. Algolia ne lit pas Prismic en direct. Aucun secret Algolia d’écriture n’est nécessaire dans le site pour ce fonctionnement.

Vérifier le comportement de suppression proposé par la tâche Algolia : une simple mise à jour des objets ne supprime pas les liens dépubliés, qui disparaissent du JSON. Utiliser une synchronisation complète avec suppression des objets absents si elle est disponible, ou prévoir une réconciliation séparée. Ne pas faire tourner simultanément le script d’ingestion manuel et le connecteur comme deux sources concurrentes.

Documentation : https://www.algolia.com/developers/code-exchange/json-connector
