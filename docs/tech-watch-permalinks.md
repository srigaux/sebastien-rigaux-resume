# Permaliens de veille

Chaque document `curated_link` publié produit une fiche HTML indexable et un export Markdown :

- Français : `/veille/liens/{uid}/` et `/veille/liens/{uid}/index.md`.
- Anglais : `/en/tech-watch/links/{uid}/` et `/en/tech-watch/links/{uid}/index.md`.

Les UID sont ceux des documents Prismic, conservés tels quels. Les traductions sont reliées exclusivement par les identifiants de `alternate_languages`. Les listes de veille comprennent aussi les ressources disponibles dans une seule langue : leur permalink et le sélecteur de langue ciblent directement la fiche publiée. Aucun chemin de traduction absent n’est inventé ; une URL inconnue reste une 404.

Les fiches reprennent le contenu existant, sans champ éditorial supplémentaire. Elles disposent de canonicals autoréférentes, de `hreflang` pour les versions publiées, et de données structurées `WebPage` et `BreadcrumbList`. Le sitemap reprend les métadonnées des pages HTML générées pour utiliser exactement les mêmes relations linguistiques ; `lastmod` provient de `last_publication_date`.

Les index `/veille/index.md` et `/en/tech-watch/index.md` recensent toutes les sélections et leurs exports. Le `llms.txt` racine référence ces index, en plus des exports du CV. Les fichiers Markdown sont exclus du sitemap SEO.

## Vérification

- `pnpm run test:watch` : normalisation, traductions, repli, exports Markdown et métadonnées du sitemap, avec les tests existants de curation/import.
- `pnpm run check` puis `pnpm run build` : types et génération statique, y compris les PDF du CV.
- `pnpm run check:watch-build` après le build : vérifie chaque fiche et export, les traductions réciproques, leur présence dans le sitemap, les index LLM et les exports existants du CV.

Ces vérifications sont intégrées au workflow de déploiement GitHub Pages. La présence dans le sitemap facilite la découverte sans garantir l’indexation par les moteurs.
