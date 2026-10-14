# Permaliens de veille

Chaque document `curated_link` publié produit une fiche HTML indexable et un export Markdown :

- Français : `/veille/liens/{uid}` et `/veille/liens/{uid}.md`.
- Anglais : `/en/tech-watch/links/{uid}` et `/en/tech-watch/links/{uid}.md`.

Les UID sont ceux des documents Prismic, conservés tels quels. Les traductions sont reliées exclusivement par les identifiants de `alternate_languages`. Les listes de veille comprennent aussi les ressources disponibles dans une seule langue : leur permalink et le sélecteur de langue ciblent directement la fiche publiée. Aucun chemin de traduction absent n’est inventé ; une URL inconnue reste une 404.

Les fiches reprennent le contenu existant, sans champ éditorial supplémentaire. Elles disposent de canonicals autoréférentes, de `hreflang` pour les versions publiées, et de données structurées `WebPage` et `BreadcrumbList`. Le sitemap reprend les métadonnées des pages HTML générées pour utiliser exactement les mêmes relations linguistiques ; `lastmod` provient de `last_publication_date`.

Les index `/veille.md` et `/en/tech-watch.md` recensent toutes les sélections et leurs exports. Le `llms.txt` racine référence ces index, en plus des exports du CV. Les fichiers Markdown sont exclus du sitemap SEO.

## Vérification

- `pnpm run test:watch` : normalisation, traductions, repli, exports Markdown et métadonnées du sitemap, avec les tests existants de curation/import.
- `pnpm run check` puis `pnpm run build` : types et génération statique, y compris les PDF du CV.
- `pnpm run check:watch-build` après le build : vérifie chaque fiche et export, les traductions réciproques, leur présence dans le sitemap, les index LLM et les exports existants du CV.

Ces vérifications sont intégrées au workflow de déploiement GitHub Pages. La présence dans le sitemap facilite la découverte sans garantir l’indexation par les moteurs.

## URL sans slash final

Le site utilise `trailingSlash: "never"` et `build.format: "file"` : `/veille/liens/mon-lien` est servi depuis `veille/liens/mon-lien.html`, avec `veille/liens/mon-lien.md` à côté. Les index, archives et pages de pagination disposent également de leur URL suivie de `.md`. La racine française `/` garde `/fr.md` ; `/en` correspond à `/en.md`.

L’intégration LLM existante attend un format `directory`. Le hook prépare donc les deux entrées du CV dans un dossier temporaire, génère les exports, les recopie dans le build public, puis supprime ce dossier. Aucun `index.html` de compatibilité ne vient masquer les nouvelles URL sans slash.

Au déploiement, configurer sur Cloudflare une redirection permanente des anciennes URL HTML avec slash final vers leur variante sans slash (en particulier `/en/` → `/en`), en conservant la racine `/`, les paramètres de requête et les URL de fichiers. Astro ne peut pas imposer ces redirections HTTP au serveur GitHub Pages. Les canonicals, liens internes et sitemaps du build utilisent exclusivement les nouvelles URL.

## Données structurées et images

Chaque index, archive thématique et page de pagination expose un `CollectionPage` dont le `mainEntity` est un `ItemList`. La liste reprend uniquement les sélections visibles sur cette page, dans leur ordre d'affichage ; les positions continuent sur les pages suivantes. Les URL pointent vers les permaliens HTML publiés, avec leur langue réelle, y compris lors d'un repli linguistique. Les fiches restent des `WebPage` avec `BreadcrumbList` : ces résumés de ressources ne sont pas présentés comme des articles originaux.

Les dimensions des images Prismic sont conservées et rendues sur les fiches pour réserver leur place avant chargement. Les métadonnées Open Graph et Twitter utilisent l'image de la ressource lorsqu'elle existe, sinon l'image de marque du site dans la langue de la page. Ces balises ne garantissent ni une indexation ni un résultat enrichi.

## Canonical HTTP des exports Markdown — activation Cloudflare

Le fichier [cloudflare-markdown-canonicals.json](cloudflare-markdown-canonicals.json) contient trois règles de modification des en-têtes de réponse : CV français, CV anglais et veille. Elles ajoutent `Link: <URL HTML>; rel="canonical"` sans écraser les autres relations `Link`. Elles ne modifient ni les URL ni le corps des exports. Les paramètres de requête sont ignorés dans la canonical, et `llms-full.txt` reste hors de ces règles car il rassemble plusieurs pages.

Ce fichier est une configuration prête à appliquer, **pas une configuration automatiquement déployée** par GitHub Pages. Dans Cloudflare, ouvrir la zone du domaine puis **Rules → Transform Rules → Modify Response Header** et ajouter les trois règles avec leurs expressions et leurs valeurs statiques/dynamiques. Le domaine doit être proxifié par Cloudflare. Avec l'API, utiliser la phase `http_response_headers_transform` et ajouter ces règles au ruleset existant ; ne pas remplacer ses autres règles par celles de ce fichier. S'il n'existe aucun ruleset dans cette phase, ce fichier peut servir de corps à sa création.

Références : [création via API](https://developers.cloudflare.com/rules/transform/response-header-modification/create-api/), [fonction substring](https://developers.cloudflare.com/ruleset-engine/rules-language/functions/#substring). L'expression dynamique retire uniquement le suffixe `.md` : `/veille/liens/exemple.md` désigne `/veille/liens/exemple`. Les règles s'appliquent aussi aux chemins inconnus correspondant au motif ; leur statut 404 doit rester inchangé et empêche leur indexation.

Après déploiement du site et activation des règles, vérifier les réponses publiques :

```sh
curl -I https://sebastien.rigaux.be/fr.md
curl -I https://sebastien.rigaux.be/en.md
curl -I https://sebastien.rigaux.be/veille.md
curl -I https://sebastien.rigaux.be/en/tech-watch.md
```

Vérifier aussi une fiche et une archive paginée dans chaque langue : statut `200`, en-tête `Link` vers la même canonical HTML que celle contenue dans l'export, et statut `404` pour une fiche inconnue. Ne pas ajouter `noindex` aux exports pour forcer cette consolidation.
