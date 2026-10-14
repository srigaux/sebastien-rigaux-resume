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

## Navigation et SEO — 14 octobre 2026

Les fiches proposent les liens précédent et suivant dans l'ordre de la veille (`selected_on` décroissant, puis date de première publication et identifiant). La navigation respecte les chemins réellement publiés, avec repli vers l'autre langue si nécessaire. Les mêmes cibles sont déclarées dans le `<head>` et dans les liens visibles avec `rel="prev"` / `rel="next"`. Les extrémités n'ont que le voisin disponible ; la navigation ne boucle pas.

Ces relations sont aussi présentes sur les index et archives paginés. Google ne les utilise plus dans le `<head>` ; elles sont conservées pour les autres consommateurs. Le maillage repose sur de vrais liens HTML. À partir de 768 px, la pagination affiche au maximum cinq numéros : première page, page précédente, page courante, page suivante et dernière page, avec des points de suspension non interactifs pour les intervalles omis. En dessous, seuls précédent/suivant et le compteur sont visibles ; les liens numérotés restent dans le HTML. La page 1 reste accessible par la pagination, sans lien « Première page » supplémentaire. Chaque page garde sa propre canonical. À partir de la page 2, le titre et la description indiquent le numéro de page pour distinguer les résultats ; Google accepte aussi des titres identiques dans une série paginée.

Le grand hero et son introduction sont réservés à la première page de chaque collection. Sur cette première page, aucun compteur ni séparateur ne précède les ressources. Les pages suivantes ont un H1 compact et un compteur, suivis directement des ressources en H2 ; le titre redondant « Tous les liens » a été retiré. Le retour depuis une archive thématique vers la veille générale est conservé.

Les archives thématiques et pages paginées disposent d'un `BreadcrumbList` lié au `CollectionPage`. Toutes les pages indexables autorisent les grands aperçus d'images via `max-image-preview:large` ; les pages `noindex` conservent leur exclusion. Cette autorisation ne garantit ni un grand aperçu ni une présence dans Discover.

Le validateur du build vérifie la concordance des voisins entre le `<head>` et les liens visibles, leur présence dans le sitemap, le retour à la première page, les numéros dans les titres et les cibles des fils d'Ariane, en plus des contrôles existants.

Références : [pagination Google](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading), [directives robots](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [fils d'Ariane](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).

### Actions à terminer sur l'hébergement et dans Search Console

Vérifications publiques effectuées le 14 octobre 2026 avec `curl -I` ; elles décrivent le déploiement en ligne, pas le nouveau build local :

- `/en/` et `/veille/` renvoient `404`. Configurer les redirections permanentes des anciennes URL avec slash vers les URL sans slash, en préservant les paramètres et la racine `/`. Vérifier aussi les anciennes archives et fiches après activation.
- `/fr` renvoie `200`, avec le mécanisme de redirection HTML existant. Ajouter une redirection HTTP permanente vers `/`.
- `/veille.html` renvoie `200`. Consolider les variantes `.html` par une redirection permanente vers la même URL sans extension, en excluant `/404.html` et en traitant `/index.html` vers `/`. Vérifier ensuite l'absence de boucle avec GitHub Pages.
- `/veille.md` renvoie `200` sans en-tête `Link` canonical. Activer les règles Cloudflare décrites ci-dessous, puis contrôler également les autres exports.
- `/robots.txt` renvoie `200` avec `Cache-Control: max-age=31536000`. Réduire la durée de cache navigateur pour ce fichier et purger le cache après une modification.
- Une fiche inconnue (`/veille/liens/seo-audit-missing-20261014`) renvoie bien `404` : conserver ce statut.
- Le client HTTP Python a reçu des `403` sur ces contrôles alors que `curl` a obtenu les statuts ci-dessus. Ce constat ne prouve pas un blocage de Googlebot. Vérifier les robots reconnus dans Cloudflare et utiliser le test d'URL en direct de Search Console pour confirmer leur accès.

Après déploiement, soumettre `https://sebastien.rigaux.be/sitemap-index.xml` dans Google Search Console et Bing Webmaster Tools, puis inspecter une fiche FR, sa traduction EN, une fiche sans traduction, une archive et une page 2. Contrôler les exclusions d'indexation, la canonical choisie par Google et les Core Web Vitals. Aucun accès à ces comptes ni mesure de trafic ou de performance réelle n'a été effectué pendant cette modification.

Pour améliorer le classement au-delà de ces réglages techniques, enrichir progressivement les résumés existants avec des observations personnelles utiles (raison de la sélection, contexte d'utilisation ou limites vérifiées) et les descriptions des sujets. Ne pas inventer d'expérience, attribuer le contenu original au curateur ou générer du texte seulement pour allonger les fiches. Le contenu Prismic n'a pas été modifié par cette optimisation. Voir les [recommandations de Google sur le contenu utile](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

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
