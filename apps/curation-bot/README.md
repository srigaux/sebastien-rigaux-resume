# Bot Telegram de curation FR/EN

Application autonome TypeScript pour Cloudflare Workers : Telegram → vérification des doublons → Context.dev → rédaction OpenAI → relecture dans Telegram → médias et traductions liées → publication Prismic.

## Installation locale

Depuis ce dossier, avec Node.js ≥22.12 et pnpm :

```sh
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
cp .dev.vars.example .dev.vars
pnpm db:local
pnpm check
pnpm test
pnpm dev
```

Le dépôt parent contient aussi un workspace : `--ignore-workspace` est nécessaire pour installer ce projet indépendamment. Ses dépendances, son lockfile et sa configuration TypeScript lui appartiennent. Les tests tournent dans workerd avec D1, R2 et de vrais Workflows locaux ; les services externes sont simulés. Ils ne lisent pas les clés du site.

Le serveur de développement est celui de Wrangler. La règle `astro dev --background` du dépôt s’applique lorsqu’on développe le site Astro.

## Debug local avec Telegram

Les appels Telegram nécessitent une URL HTTPS publique. Dans un premier terminal :

```sh
pnpm db:local
pnpm dev
```

Dans un second terminal, avec `cloudflared` installé :

```sh
cloudflared tunnel --url http://localhost:8787
```

Reporter l’URL `https://…trycloudflare.com` obtenue dans `PUBLIC_BOT_URL` de `.dev.vars`, puis exécuter `pnpm telegram:webhook register` et `pnpm telegram:webhook info`. Utiliser le même `TELEGRAM_WEBHOOK_SECRET` que celui chargé par Wrangler. Si vous modifiez les secrets locaux, redémarrez `pnpm dev` avant l’enregistrement. L’URL change à chaque nouveau tunnel.

Le webhook est alors dirigé vers la machine locale : le bot déployé ne reçoit plus les nouveaux messages. D1, R2 et Workflows sont locaux ; les appels Context.dev, OpenAI et Telegram restent réels. Conserver `PUBLISH_ENABLED=false` pour tester sans publication. Envoyer un nouveau lien dans Telegram : une fiche annulée ou présente seulement en production n’est pas reprise dans la base locale.

Les logs sont affichés dans le terminal `pnpm dev`. `editorial.start` indique la fiche, le modèle et la taille des catalogues ; `editorial.complete` indique les sujets choisis et la durée. `editorial.topics.invalid` affiche les sujets proposés et les uid autorisés. Les erreurs de Workflow indiquent la fiche, la phase et le message applicatif. Aucun contenu intégral ni secret n’est journalisé. En production, utiliser `pnpm exec wrangler tail`.

Après le debug, remettre l’adresse du Worker dans `PUBLIC_BOT_URL` et relancer `pnpm telegram:webhook register` pour rétablir la réception en production.

## Comptes et secrets

1. Créer un bot avec **@BotFather** dans Telegram. Copier son token dans `.dev.vars`.
2. Ouvrir une conversation privée avec ce bot et envoyer `/start`.
3. Avant de définir son webhook, exécuter `pnpm telegram:webhook identity`. Reporter uniquement vos propres `userId` et `chatId` dans `TELEGRAM_USER_ID` et `TELEGRAM_CHAT_ID`.

   Si `identity` signale un webhook actif (conflit 409), `pnpm telegram:webhook info` permet de l’inspecter. Pour transférer ce bot à cette application, retirer explicitement ce webhook avec `pnpm telegram:webhook unregister`, envoyer `/start` au bot, puis relancer `identity`. La suppression conserve les messages en attente mais interrompt la livraison à l’ancien service ; réactiver ensuite la réception avec `pnpm telegram:webhook register`. Si un autre programme utilise `getUpdates`, l’arrêter avant de relancer `identity`. La commande `identity` ne retire jamais automatiquement un webhook.

4. Générer `TELEGRAM_WEBHOOK_SECRET` avec `openssl rand -hex 32`.
5. Fournir `OPENAI_API_KEY`, `CONTEXT_DEV_API_KEY` et le **write token** `PRISMIC_WRITE_TOKEN`. Un éventuel `PRISMIC_ACCESS_TOKEN` est distinct : il sert à la lecture d’un repository privé.

Ne pas committer `.dev.vars`. La clé OpenAI utilise le modèle `OPENAI_MODEL`, initialement `gpt-5-mini`.

Le bot vérifie le secret du webhook, l’identifiant utilisateur et celui du chat privé. Les réponses de tiers et les conversations de groupe sont ignorées. Les messages et médias approuvés restent dans D1/R2 ; définir la rétention opérationnelle selon vos besoins, en conservant les fichiers des fiches en attente. Ne pas activer de suppression globale R2 qui effacerait leurs extractions.

## Réserver la release de migration avant toute publication

**`publishMigrationRelease()` publie la totalité de la release de migration de `bd7d5fa0`.** Le client JS ne permet pas de lui donner l’identifiant d’une release dédiée.

Avant d’activer `PUBLISH_ENABLED` :

1. Examiner dans Prismic la release de migration existante et traiter son contenu séparément. Le bot ne la purge pas et ne publie pas son contenu préexistant.
2. Réserver la Migration API à ce bot. Arrêter les autres imports utilisant `createWriteClient().migrate()`, y compris les scripts historiques, pendant son exploitation. Les releases éditoriales ordinaires peuvent continuer à être utilisées.
3. Vérifier que la release de migration est vide, puis passer `PUBLISH_ENABLED` à `"true"` dans `wrangler.jsonc`.

Cette vérification est une précondition opérateur : le SDK n’expose pas d’inventaire global fiable des brouillons de migration. Le verrou D1 protège les instances du bot ; il ne verrouille pas les autres outils qui écriraient directement dans Prismic. Le contrôle de `totalItems` après la demande de publication est un diagnostic, pas une possibilité d’annuler une publication étrangère.

## Déploiement Cloudflare

Créer les ressources (les commandes retournent les identifiants à reporter dans `wrangler.jsonc`) :

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create curation-bot
pnpm exec wrangler r2 bucket create curation-bot-private
pnpm db:remote
```

Remplacer le `database_id` d’exemple avant `db:remote`. Conserver le bucket **privé**. Le binding Workflow est créé par Wrangler au déploiement.

Enregistrer les secrets, chacun via sa saisie interactive :

```sh
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm exec wrangler secret put TELEGRAM_USER_ID
pnpm exec wrangler secret put TELEGRAM_CHAT_ID
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put CONTEXT_DEV_API_KEY
pnpm exec wrangler secret put PRISMIC_WRITE_TOKEN
# Seulement si la Content API nécessite ce token :
pnpm exec wrangler secret put PRISMIC_ACCESS_TOKEN
pnpm deploy:dry
pnpm deploy
```

Reporter l’URL HTTPS obtenue dans `PUBLIC_BOT_URL` de `.dev.vars`, puis :

```sh
pnpm telegram:webhook register
pnpm telegram:webhook info
pnpm exec wrangler tail
```

`PUBLIC_BOT_URL` sert seulement au script local d’enregistrement. `/health` est public et ne révèle aucun paramètre. Le webhook `/telegram` n’accepte que les mises à jour authentifiées. L’enregistrement conserve les mises à jour en attente.

## Utilisation

Envoyer par exemple :

```text
https://example.com/article
Insiste sur les usages pour une petite équipe frontend.
source: JavaScript Weekly
```

Chaque message contenant un nouveau lien entre dans la file. Plusieurs URL dans le même message déclenchent un choix du lien principal. Les liens des messages suivants attendent la fin de la fiche active.

- `/statut` : fiche active et éventuelle erreur.
- `/file` : fiches en cours et en attente.
- `/annuler` : annuler la fiche active avant le début de la migration.
- `/reprendre` : reprendre une extraction, un média ou une publication interrompus.

Les doublons sont cherchés parmi les documents **publiés** et les soumissions du bot. Les brouillons créés dans d’autres outils ne sont pas énumérables globalement avec la Content API. Les paramètres de suivi connus et fragments sont ignorés ; les paramètres fonctionnels et les chemins distincts sont conservés.

Le bot présente FR/EN, format, sujets, crédit de l’article, dates, source et fichiers médias. Les images et icônes sont envoyées en documents Telegram pour conserver les octets originaux, y compris SVG/ICO. Les mêmes fichiers R2 sont importés dans Prismic après validation ; les traductions partagent leurs IDs d’assets et possèdent des textes alternatifs localisés.

Si la source n’est pas fournie, choisir la suggestion, ouvrir la liste ou répondre « Aucune ». Une suggestion ne devient jamais une attribution certaine sans choix explicite.

Répondre à la dernière fiche pour donner une nouvelle direction. « valider », « publier » ou « oui » sont acceptés seulement en réponse à sa dernière version ; le bouton **Publier FR + EN** produit le même accord. Une correction ou un changement de source invalide l’accord précédent. Un ancien bouton ou une réponse à une ancienne fiche est refusé.

Le bouton **Changer l’image** propose les autres images extraites de la page, ainsi qu’une publication sans image. Le choix déclenche une nouvelle proposition à valider.

Un média indisponible doit être retenté ou faire l’objet d’une omission explicite avant validation. Le bot ne copie pas le nom de l’auteur de la page dans les crédits des images : leurs droits/attributions doivent être connus séparément.

## Reprises et limites

L’inbox Telegram est enregistrée avant HTTP 200. Le cron interne récupère les messages dont le traitement a été interrompu et démarre la prochaine fiche. Les événements Workflow sont des signaux de réveil ; D1 conserve les actions réelles. Les workflows continuent depuis D1 au bout de 30 cycles pour rester sous les limites de la plateforme.

Context.dev : trois tentatives, pauses de 5/15 secondes avec jitter et respect de `Retry-After`. Délai API/client 90/120 secondes, puis 180/210 après un timeout. Retries du SDK et des étapes englobantes désactivés. Les `success` individuels sont contrôlés même après HTTP 200. Les erreurs définitives s’arrêtent immédiatement ; une extraction exploitable et les bons médias sont conservés. Les journaux ne contiennent ni clé ni article complet.

Les fichiers sont limités à 10 Mio et les extractions à 220 000 caractères. Une extraction trop longue n’est pas tronquée silencieusement. Les URL doivent utiliser un nom de domaine HTTP(S) public ; les redirections des téléchargements sont validées à chaque saut. Les types de médias refusés par Prismic sont signalés pour omission ou reprise.

La publication est sérialisée et son accord porte sur une version exacte. Chaque réponse d’écriture Prismic est enregistrée avant d’être rendue au SDK. Une reprise reconstitue les références de migration en rejouant ces réponses connues ; elle ne réémet pas leurs POST/PUT. Une réponse perdue reste incertaine et bloque les écritures suivantes. Les refus 429 peuvent être retentés avec un budget durable.

Après le HTTP 202, le bot vérifie les deux documents et leurs relations, contenus et médias dans la Content API. Si la publication tarde, `/reprendre` revérifie. Le message de réussite concerne Prismic ; le site Astro attend sa reconstruction habituelle.

### Réconcilier une écriture incertaine

La fiche reste en erreur et le verrou de publication reste détenu. Ne pas annuler la fiche, supprimer le verrou ni effacer le journal pour « débloquer » l’import.

```sh
pnpm reconcile inspect u123 --remote
```

Le résultat donne l’opération, son endpoint, son état et ses identifiants connus. Examiner l’opération dans Prismic, en recoupant l’UID et la langue de la fiche. Attendre d’être certain qu’aucune requête n’est encore en cours.

- Si l’écriture a réussi, enregistrer sa **réponse réelle** dans un fichier JSON privé : `{ "id": "..." }` pour une création, `{ "id": "...", "url": "...", "width": 1200, "height": 630 }` pour un asset, `{}` pour un PUT confirmé, `{ "totalItems": 2 }` pour la publication confirmée.
- Si elle n’a certainement pas été appliquée, la marquer retentable.

```sh
pnpm reconcile confirm-success 'CLE_OPERATION' /tmp/prismic-response.json --remote --reviewed-in-prismic
# OU, uniquement après vérification certaine de l’absence d’écriture :
pnpm reconcile confirm-not-applied 'CLE_OPERATION' --remote --reviewed-in-prismic
```

Puis `/reprendre` dans Telegram. Le script exige une fiche arrêtée en erreur et une opération incertaine ; il ne crée ni ne supprime de contenu Prismic.

## Recette connectée

Après configuration et réservation de la migration :

1. Envoyer une page possédant auteur, image et favicon ; vérifier les crédits et les deux fichiers reçus.
2. Donner une correction et vérifier la nouvelle paire FR/EN ; essayer un ancien bouton de validation.
3. Choisir la source ou « Aucune », puis valider la dernière version.
4. Vérifier dans Prismic les deux langues liées, leurs images/icônes CDN, dimensions, textes alternatifs, résumés et dates.
5. Renvoyer le même lien pour vérifier la demande de confirmation de doublon.

La suite automatisée simule les fournisseurs. Une recette réelle, une livraison webhook ou un déploiement ne sont pas considérés vérifiés sur la seule base de ces tests.
