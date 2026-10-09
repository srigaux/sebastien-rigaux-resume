# CV de Sébastien Rigaux

Site statique bilingue construit avec Astro 7, React et Tailwind CSS 4. Le contenu du CV se trouve directement dans les composants Astro de `src/components/`. Les pages `/fr/` et `/en/` partagent la même mise en page ; Astro redirige `/` vers `/fr/`.

## Développement

Node.js 22.12 ou plus récent et pnpm sont nécessaires.

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

Le build statique est généré dans `dist/`. Les fontes IBM Plex sont récupérées par Astro Fonts lors du premier build, puis servies depuis le site.

`astro-pdf` génère aussi `dist/fr.pdf` et `dist/en.pdf` à partir des pages imprimables. Après `pnpm build`, utiliser `pnpm astro preview` pour tester les téléchargements en local. Les PDF sont régénérés à chaque publication et par le workflow annuel du 1er février pour actualiser les années d’expérience.

## Publication

Le workflow `.github/workflows/deploy.yml` publie `master` sur GitHub Pages. Dans les paramètres du dépôt, sélectionner **GitHub Actions** comme source Pages. `public/CNAME` configure le domaine `sebastien.rigaux.be` ; le DNS doit pointer vers GitHub Pages. Lors de la bascule, retirer ce domaine personnalisé de l'ancien dépôt Pages avant de l'activer sur ce dépôt. Vérifier ensuite `/fr/`, `/en/`, le certificat HTTPS et le sitemap.

Le site est statique : l'âge et les années d'expérience sont calculés au build et rafraîchis au chargement par un petit script. Le CV reste lisible sans JavaScript.
