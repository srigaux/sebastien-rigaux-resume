# Cloudflare Pages — sebastien.rigaux.be

## Architecture

Astro reste statique. GitHub Actions conserve le build, Chromium/PDF, les tests et le contrôle des publications Prismic. Wrangler envoie `apps/website-astro/dist` au projet Direct Upload `sebastien-rigaux`, branche de production `master`. Aucune Pages Function ni conversion HTML à la volée.

Chaque page de contenu HTML a un export voisin `.md` : `/en` → `/en.md`, `/veille/liens/exemple` → `/veille/liens/exemple.md`. La racine `/` utilise `/index.md`. Les deux CV sont exportés par `@4hse/astro-llms-txt` ; la veille garde ses exports structurés depuis les données sources. Il n'est pas nécessaire d'ajouter une deuxième intégration Markdown. Le contrôle `check-pages-build.mjs` impose un export et un lien de découverte pour chaque page HTML de contenu. La page 404, les flux, les assets et les redirections ne sont pas des pages de contenu.

## Prérequis et première publication

1. Créer un projet Pages **Direct Upload** (déjà créé dans le compte personnel le 9 novembre 2026), nommé `sebastien-rigaux`, branche de production `master`. Ne pas activer une deuxième intégration Git qui déclencherait des builds en double.
2. Créer l'environnement GitHub `cloudflare-pages`. Ajouter le secret `CLOUDFLARE_API_TOKEN` (Account / Cloudflare Pages / Edit sur le compte concerné) et la variable `CLOUDFLARE_ACCOUNT_ID`. Garder `CLOUDFLARE_DOMAIN_ACTIVE` absent ou `false` avant la bascule.
3. Intégrer les changements du dépôt sur `master`, puis déclencher `deploy.yml` (ou laisser le push le déclencher). Le build est identique au build précédent ; les artefacts sont conservés sept jours. Le fichier `deployment-state.json` est publié avec le site.
4. Vérifier `https://sebastien-rigaux.pages.dev`, les PDF, les flux, les 404 et les exports directs. Les Rewrite Rules de zone ne s'appliquent **pas** à `pages.dev`.
5. Pour une prévisualisation manuelle avant production, utiliser une branche Pages différente : `pnpm --filter website-astro exec wrangler pages deploy dist --project-name=sebastien-rigaux --branch=migration-preview`. Une prévisualisation locale non issue du workflow peut utiliser `{"preview":true}` dans `deployment-state.json` ; ne jamais promouvoir cet artefact en production. Les prévisualisations doivent conserver leur en-tête `X-Robots-Tag: noindex`.

## Zone et sous-domaine

La zone à administrer est **rigaux.be**, pas une nouvelle zone `sebastien.rigaux.be`. Chaque règle de zone fournie contient exactement `http.host eq "sebastien.rigaux.be"`. Aucun changement n'est prévu pour le domaine racine, `www` ou les autres sous-domaines.

Dans Pages, associer **sebastien.rigaux.be** comme domaine personnalisé avant la bascule DNS. L'enregistrement à remplacer dans la zone `rigaux.be` est uniquement le CNAME **sebastien**, cible **sebastien-rigaux.pages.dev**, avec proxy Cloudflare activé pour les règles. Ne pas modifier les nameservers ou les enregistrements mail. Sauvegarder la valeur DNS précédente et vérifier le certificat HTTPS.

## Règles à appliquer dans Cloudflare

Les fichiers JSON sont des configurations de rulesets, **pas des règles déployées par Wrangler Pages** :

| Fichier                               | Phase                             | Usage                                                                                                 |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cloudflare-redirects.json`           | `http_request_dynamic_redirect`   | 301 `/fr`, `/fr/`, `/fr.html`, `/fr/index.html` → `/` et `/fr.md` → `/index.md`, paramètres conservés |
| `cloudflare-rewrites.json`            | `http_request_transform`          | Négociation Markdown sans changer l'URL du client                                                     |
| `cloudflare-markdown-canonicals.json` | `http_response_headers_transform` | Liens canoniques HTML des exports Markdown                                                            |

Ajouter ou mettre à jour **uniquement les règles identifiées par leur `ref`** dans les rulesets existants. Ne jamais remplacer un ruleset complet de `rigaux.be` : il peut gérer d'autres sous-domaines. Le fichier peut servir à créer un ruleset seulement si cette phase n'en possède pas. Les anciennes règles `markdown_cv_fr`, `markdown_cv_en`, `markdown_watch` doivent être mises à jour, pas dupliquées.

Les redirections de zone s'exécutent avant les réécritures. Le fichier Pages `_redirects` fournit les mêmes redirections locales sur les déploiements Pages, y compris les previews ; il ne modifie pas les autres sites de la zone.

### En-têtes Accept reconnus

La politique est volontairement conservatrice : signatures documentées, pas un parseur HTTP général. `pages-policy.mjs` contient la liste et génère les deux fichiers de règles (testés contre cette source). La casse et les espaces autour de l'en-tête sont ignorés ; les formes avec espaces après les virgules et les formes compactes sont reconnues.

- `text/markdown`, avec éventuellement `;q=1` ou `;q=1.0`.
- `text/markdown, text/html` ou `text/html, text/markdown` : égalité, Markdown choisi.
- MCP Fetch : `text/markdown, text/html;q=0.9, */*;q=0.8`.
- OpenCode : `text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1`.
- `text/markdown, */*;q=0.1` et `text/markdown;q=1.0, */*;q=0.1`.

Toute autre valeur reste en HTML, notamment les préférences HTML supérieures, Markdown `q=0`, `*/*`, les en-têtes absents ou plusieurs lignes Accept. Aucun ciblage par User-Agent et aucune assimilation de `*/*` à un robot IA. Les requêtes GET/HEAD seules sont concernées. Les URL contenant un point, dont `.md`, ne sont jamais réécrites : pas de `.md.md`. Les slashs finaux sont retirés avant l'ajout de `.md`.

Références : [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/), [OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/webfetch.ts), [MCP Fetch](https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/README.md), [Rewrite Rules](https://developers.cloudflare.com/rules/transform/url-rewrite/).

## Cache et découverte

`_headers` réserve un an de cache navigateur immutable aux assets hashés sous `/_astro/`. Les autres fichiers gardent la revalidation Pages par défaut, notamment PDF, HTML, Markdown et flux. `/deployment-state.json` utilise `no-store`.

Les réponses HTML négociables et leurs exports ont `Vary: Accept`. Les exports utilisent `Content-Type: text/markdown; charset=utf-8`. La réécriture sélectionne un fichier distinct avant le cache ; aucune règle globale « Cache Everything » n'est ajoutée. Auditer les éventuelles règles de cache déjà présentes sur ce sous-domaine : elles ne doivent pas fusionner les représentations ni conserver l'empreinte de publication. Vérifier les ETag et l'alternance HTML/Markdown après activation.

Les pages HTML annoncent déjà leur export via `link rel="alternate" type="text/markdown"`, et `llms.txt` fournit un index. Les canonical restent les URL HTML. Conserver les accès des robots de recherche et de lecture dans robots.txt et les réglages AI Crawl Control ; cela n'implique pas d'autoriser l'entraînement.

## Vérification et bascule

```sh
pnpm --filter website-astro test
pnpm --filter website-astro build
pnpm --filter website-astro check:watch-build
# Écrire l'empreinte via le workflow avant check-pages-build.
node apps/website-astro/scripts/check-pages-build.mjs
node apps/website-astro/scripts/check-pages-live.mjs https://sebastien-rigaux.pages.dev
# Après association du domaine, bascule DNS et application des règles :
node apps/website-astro/scripts/check-pages-live.mjs https://sebastien.rigaux.be
```

Le contrôle distant vérifie les 301 et paramètres, les types MIME, les 404, le cache de l'empreinte et l'alternance HTML/Markdown/HTML sur le domaine de production. Avec `EXPECTED_FINGERPRINT`, il attend jusqu'à une minute que le domaine serve la bonne version. Le contrôle local impose les limites Free : 20 000 fichiers, 25 MiB par fichier.

Après succès sur le domaine, définir `CLOUDFLARE_DOMAIN_ACTIVE=true` : chaque publication exécutera alors le contrôle distant. Vérifier également une publication Prismic réelle et sa détection par le bot. Désactiver GitHub Pages seulement après validation ; aucun ancien déploiement n'est supprimé automatiquement.

## Retour arrière

Pour un défaut de contenu, restaurer un déploiement Pages précédent. Pour revenir à GitHub Pages, conserver son ancien déploiement, restaurer le CNAME sauvegardé, désactiver uniquement les nouvelles règles de ce site, puis restaurer l'ancien workflow, la page de redirection HTML et l'export `fr.md` depuis Git. Les Rewrite Rules et la 301 `/fr.md` ne doivent pas pointer vers `/index.md` si l'ancien artefact ne le contient pas. La 301 pouvant être mémorisée par les clients, publier aussi un alias `index.md` dans l'artefact de secours avant une bascule effective.

## État de livraison

Les fichiers du dépôt préparent la migration. Le projet Pages `sebastien-rigaux` a été créé. Les secrets GitHub, les règles de zone et le DNS restent à configurer ; leur présence dans ce dépôt ne prouve pas leur activation en production.

Validation du 9 novembre 2026 : projet créé et artefact déployé sur [migration-preview.sebastien-rigaux.pages.dev](https://migration-preview.sebastien-rigaux.pages.dev) ([déploiement immuable](https://f02f7071.sebastien-rigaux.pages.dev)). Les 52 tests du site, le build complet avec PDF, le contrôle des exports de veille et celui des 5 547 fichiers Pages ont réussi. Le contrôle HTTP de prévisualisation a validé redirections, types Markdown, HEAD/ETag/304, 404 et empreinte non mise en cache. La négociation de zone reste à vérifier après activation sur le domaine personnalisé. Aucun DNS de production n’a été modifié.

Le build optimisé a remplacé la première prévisualisation : 3 090 images générées pour 39,7 Mio, contre 10 583 pour 414,5 Mio. Les qualités d’encodage restent inchangées. Le HTML de la liste servi a été comparé au build local ; les images AVIF/WebP et le CSS sont accessibles avec un cache immutable d’un an, les deux PDF répondent correctement et la prévisualisation conserve `noindex`. Les variantes Retina 2× ont été vérifiées localement dans Chromium sur six largeurs d’écran, pour une source suffisamment grande.
