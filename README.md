# CV de Sébastien Rigaux

Site statique bilingue construit avec Astro 7, React et Tailwind CSS 4. Le contenu du CV se trouve directement dans les composants Astro de `apps/website-astro/src/components/`. Les pages `/` (français) et `/en` partagent la même mise en page.

## Développement

Node.js ^24.22.1 et pnpm sont nécessaires.

```sh
pnpm install
pnpm astro dev --background
pnpm astro dev status
pnpm astro dev logs
pnpm astro dev stop
```

```sh
pnpm astro check
pnpm build
```

Le build statique est généré dans `apps/website-astro/dist/`. Les fontes IBM Plex sont récupérées par Astro Fonts lors du premier build, puis servies depuis le site.

`astro-pdf` génère aussi les deux CV dans `apps/website-astro/dist/pdf/` à partir des pages imprimables. Après `pnpm build`, utiliser `pnpm astro preview` pour tester les téléchargements en local. Les PDF sont régénérés à chaque publication et par le workflow annuel du 1er février pour actualiser les années d’expérience.

Le build génère également `llms.txt`, `fr.md`, `en.md` et `llms-full.txt` à partir du HTML public. Le contrôle de build échoue si un export Markdown est vide. Les choix SEO et GEO sont documentés dans [`SEO_AUDIT.md`](SEO_AUDIT.md).

## Publication

Le workflow **🔎 Check website updates** (`.github/workflows/check-website-updates.yml`) compare la référence publiée de Prismic à l’empreinte disponible dans `/deployment-state.json` sur le site, deux fois par heure (minutes 17 et 47, selon le planning UTC de GitHub). Sans changement de contenu, de sources du site ou de période annuelle de rafraîchissement des PDF (1er février), il termine avec le résumé « ⏭️ No changes — publication skipped », sans créer de run de publication. Le contrôle reste marqué comme réussi dans GitHub, puisqu’il a bien été exécuté. Il peut également être lancé manuellement pour effectuer la même comparaison.

Si nécessaire, le contrôleur déclenche **🚀 Publish Astro website** (`.github/workflows/deploy.yml`) via `workflow_dispatch`, avec un titre daté en heure de Bruxelles. Il utilise le `GITHUB_TOKEN` avec `actions: write`, sans secret supplémentaire. Les pushs concernés et les lancements manuels du workflow de publication forcent toujours le build, ainsi que le contrôle annuel du 1er février. L’empreinte est relue avant le build et incluse dans l’artefact publié : un échec de build ou de déploiement laisse la précédente en place et le prochain contrôle retente la publication. Une erreur API fait échouer le contrôle ; une empreinte absente déclenche le premier build. Pour consulter uniquement les publications dans GitHub Actions, sélectionner le workflow **🚀 Publish Astro website** ; « All workflows » inclut aussi les contrôles.

Le workflow `.github/workflows/deploy.yml` publie `master` sur GitHub Pages. Dans les paramètres du dépôt, sélectionner **GitHub Actions** comme source Pages. `apps/website-astro/public/CNAME` configure le domaine `sebastien.rigaux.be` ; le DNS doit pointer vers GitHub Pages. Lors de la bascule, retirer ce domaine personnalisé de l'ancien dépôt Pages avant de l'activer sur ce dépôt. Vérifier ensuite `/`, `/en`, le certificat HTTPS et le sitemap. L'ancienne URL `/fr/` redirige immédiatement vers `/` au moyen d'une page HTML statique ; GitHub Pages ne fournit pas de redirection HTTP 301 pour ce cas. La checklist de mise en ligne et de suivi SEO se trouve dans [`SEO_CHECKLIST.md`](SEO_CHECKLIST.md).

Le site est statique : l'âge et les années d'expérience sont calculés au build et rafraîchis au chargement par un petit script. Le CV reste lisible sans JavaScript.

## Veille technologique

La rubrique `/veille` et sa version anglaise `/en/tech-watch` lisent le dépôt Prismic `bd7d5fa0` pendant le build. Le CV reste dans les composants Astro. Les nouvelles fiches `curated_link` sont liées en traductions `fr-be` / `en-us` : chaque page affiche son titre et son bref résumé dans sa langue. Les anciennes fiches sans traduction gardent leur texte anglais sur les deux pages. Le champ `source_language` (EN/FR) décrit la langue du lien original et s'affiche discrètement sur la carte lorsqu'il est renseigné. `summary` contient du Markdown léger affiché sans HTML brut. Une fiche ouvre directement son URL d'origine. Les archives de topics publiés sont sous `/tags/<slug>/`, avec 30 liens par page et un tri par `selected_on` décroissant. Les UID Prismic propres à chaque langue servent aux permaliens `/veille/liens/{uid-fr}` et `/en/tech-watch/links/{uid-en}`. Les relations de traduction Prismic déterminent le sélecteur de langue et les `hreflang`.

Les modèles `curated_link`, `topic` et `discovery_source` se trouvent dans `apps/cms-prismic/`. Ce petit projet auxiliaire permet d'utiliser la CLI Prismic, qui ne prend pas encore Astro en charge pour le Type Builder. Modifier les modèles avec `npx prismic` depuis ce dossier, puis enregistrer les modèles dans Git avant `npx prismic push`. Les `uid` des topics et des sources sont des slugs ASCII uniques en kebab-case ; garder le même slug lorsque le nom affiché change. Si un slug d'archive doit changer, ajouter une redirection depuis l'ancien.

Le vocabulaire proposé est dans [`docs/tech-watch-seed.json`](docs/tech-watch-seed.json). Il sert de référence pour créer les topics et les newsletters dans Prismic via son MCP. Trois fiches d'exemple, avec leurs URL d'origine vérifiées, sont préparées dans [`docs/tech-watch-examples.json`](docs/tech-watch-examples.json). La liste ne publie aucun lien de newsletter automatiquement. Pour chaque fiche, renseigner l'URL d'origine, un titre, un résumé original, une date de sélection, un format et idéalement deux à cinq topics existants. `credit`, `discovered_via`, `published_on`, `image` et `site_icon` sont facultatifs. Les images peuvent venir d'oEmbed ou d'Open Graph ; une favicon suffit souvent. Sans icône, le site affiche un monogramme. Un extrait collé sans URL d'origine reste un brouillon.

Le skill [`curate-prismic-link`](.agents/skills/curate-prismic-link/SKILL.md) traite une URL et une note facultative avec Context.dev, rédige les deux versions et les envoie en brouillons liés dans une migration release Prismic. Définir `CONTEXT_DEV_API_KEY` et `PRISMIC_WRITE_TOKEN` dans l'environnement ou dans `.env.local` (ignoré par Git). Le script d'envoi propose un aperçu sans écriture par défaut ; `--write` crée les brouillons, sans les publier.

Le workflow GitHub Pages reconstruit le site toutes les quatre heures et reste déclenchable manuellement. Si Prismic ne répond pas, le build échoue et aucun nouveau déploiement ne remplace la version en ligne. Les PDF concernent le CV ; la veille expose aussi des exports Markdown, accessibles en ajoutant `.md` aux URL HTML sans slash final. Voir [`docs/tech-watch-permalinks.md`](docs/tech-watch-permalinks.md) pour les routes et vérifications.

## Workspace pnpm

Une installation à la racine (`pnpm install --frozen-lockfile`) couvre toutes les apps :

- `apps/website-astro` : site Astro et tests de ses exports.
- `apps/curation-bot` : bot Telegram sur Cloudflare.
- `apps/cms-prismic` : modèles, types et outillage Prismic.
- `apps/n8n-curation` : générateur et exports des workflows n8n.

`pnpm dev`, `pnpm build`, `pnpm preview` et `pnpm astro` ciblent le site. `pnpm check` et `pnpm test` vérifient le workspace et les outils de curation. `pnpm check:watch-build` valide les exports après le build. Pour une app précise : `pnpm --filter curation-bot check` ou `pnpm --filter n8n-curation build`. Les scripts des skills, les données de `docs/` et les états privés `.local/` restent à la racine. `.env.local` reste à la racine ; `.dev.vars` appartient au bot.
