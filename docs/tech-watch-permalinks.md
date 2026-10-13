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
