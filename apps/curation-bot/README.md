# Bot Telegram de curation FR/EN

Application autonome TypeScript pour Cloudflare Workers : Telegram → vérification des doublons → Context.dev → rédaction OpenAI → relecture dans Telegram → médias et traductions liées → publication Prismic.

## Installation locale

Depuis ce dossier, avec Node.js ^24.22.1 et pnpm :

```sh
pnpm --workspace-root install --frozen-lockfile
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

Les logs sont affichés dans le terminal `pnpm dev`. `editorial.start` indique la fiche, le modèle et la taille des catalogues ; `editorial.complete` indique les sujets choisis et la durée. `editorial.topics.invalid` affiche les sujets proposés et les uid autorisés. Les erreurs de Workflow indiquent la fiche, la phase, le type d’erreur et les emplacements de pile nettoyés. Aucun contenu intégral ni secret n’est journalisé. En production, utiliser `pnpm exec wrangler tail`.

Après le debug, remettre l’adresse du Worker dans `PUBLIC_BOT_URL` et relancer `pnpm telegram:webhook register` pour rétablir la réception en production.

## Observabilité Cloudflare

`wrangler.jsonc` active les Workers Logs persistants à 100 %, les logs d’invocation et l’envoi des source maps. Redéployer pour appliquer cette configuration :

```sh
pnpm deploy
pnpm logs
# JSON pour archivage ou traitement local :
pnpm logs:json
```

Dans Cloudflare, ouvrir **Workers & Pages → sebastien-rigaux-curation-bot → Observability → Logs**. Sélectionner la période, puis filtrer le champ `itemId` avec l’identifiant affiché dans Telegram, par exemple `u428354575`. Si le champ n’est pas encore proposé, chercher cet identifiant dans les messages. Filtrer `level=error` pour les erreurs, et `event=retry.failed` pour les tentatives échouées : une erreur rattrapée dans un Workflow ne fait pas nécessairement échouer l’invocation HTTP.

Pour une vue applicative lisible, filtrer `service = curation-bot` : cela écarte les événements d’invocation (par exemple `* * * * *`) et les spans techniques D1/fetch générés par Cloudflare. Afficher les colonnes **Message**, `event`, `itemId`, `activity`, `durationMs`, `httpStatus`, `errorType`. `curation.operation` est un attribut de span natif ; utiliser `operation` pour les logs applicatifs. La colonne Error de Cloudflare ne remplace pas notre champ `errorType` pour les erreurs rattrapées.

Chaque événement applicatif possède un `message` lisible, par exemple `Récupération du contenu de l’article — nouvelle tentative prévue | fiche u42 | tentative 2 | dans 20 s`. La colonne `activity` donne le nom lisible de l’étape. Les identifiants `operation` et `step` restent dans les détails techniques et ne sont pas interpolés dans le message. Les étapes internes de sauvegarde et de lecture ne produisent plus de messages de début/fin ; leurs erreurs restent visibles. Les passages du cron n’émettent plus de début/fin systématiques ; les événements métier et les erreurs restent journalisés. Ces changements s’appliquent aux nouveaux logs après déploiement.

Les événements sont des objets structurés, avec `timestamp`, `service`, `event`, `operation`, `message` et `level`. Selon le contexte : `itemId`, `workflowId`, `generation`, `updateId`, `traceId`, `spanId`, `parentSpanId`, `step`, `durationMs`, `httpStatus`, `providerRequestId`. `traceId` et `spanId` sont des identifiants applicatifs ; le `traceId` logique du Workflow reste identique dans une génération, y compris après reprise. Utiliser `itemId` pour relier les générations et les requêtes Telegram : une attente humaine n’est pas une unique invocation Cloudflare continue.

Parcours à rechercher : `telegram.accepted` → `item.queued` → `workflow.create` → `operation.start` / `operation.complete` pour chaque étape réellement exécutée → `workflow.waiting` → `workflow.action` → `workflow.finished`. Les étapes rejouées depuis le cache durable ne réémettent pas leurs logs d’exécution. Les étapes couvrent catalogue, doublons, extraction, médias, génération, migration, publication et vérification. `retry.failed` donne tentative, caractère temporaire, timeout et identifiant fournisseur disponible ; `retry.scheduled` donne le délai et la prochaine tentative. `operation.failed` conserve le type, le statut HTTP et les lignes de pile utiles, sans le message brut du SDK.

Dans **Workflows → curation → Instances**, ouvrir l’instance correspondant à `workflowId` (`u…-g…`) pour inspecter les étapes persistées et les attentes. Les logs temps réel de `pnpm logs` montrent les événements qui arrivent après son lancement ; l’historique se consulte dans Observability selon la rétention du compte.

Les mesures utilisent uniquement les logs structurés et l’API native `tracing` de `cloudflare:workers` : aucun stockage de métriques, migration ou dépendance supplémentaire. `curation.outcome` distingue réussite et échec, même lorsqu’une tentative échouée retourne un résultat durable sans lever d’exception. Une tentative échouée n’émet pas de message « terminé ».

Les appels CMS sont distingués par lecture, transfert de média, création FR/EN, enregistrement FR/EN et demande de publication. `replayed=true` indique une réponse récupérée dans le journal existant, sans nouvel appel. `reasonCode` fournit une raison métier stable et un texte contrôlé ; les messages bruts des fournisseurs restent exclus.

`editorial.usage` donne `model`, `revision`, `inputTokens`, `outputTokens` et `totalTokens`, également attachés au span natif actif. Les compteurs absents du fournisseur restent absents. `queueWaitMs` mesure le délai jusqu’à la création de la première instance et `elapsedMs` le temps écoulé depuis réception (attentes humaines incluses). Les durées des spans mesurent les opérations exécutées, pas un parcours durable entre plusieurs invocations.

Les événements de disponibilité ajoutent `checks`, `pendingMs` et `nextCheckAt` depuis le suivi de publication déjà existant. Les échecs de notification après confirmation ont leur propre événement et n’incrémentent plus le nombre de lectures de vérification. Dans Workers Logs, filtrer par événement, fournisseur ou `reasonCode` pour agréger les erreurs et par `model` pour consulter les consommations. Ces agrégations portent sur les événements collectés, sans garantie de compteur exact une seule fois entre reprises et échantillonnage.

Les décisions qui interrompent ou suspendent le parcours ont leur événement : `item.duplicate` (nombre de correspondances sans titres ni URL), `publication.slot.waiting`, `publication.request.accepted` et `publication.request.unknown`. Ce dernier indique une vérification sans renvoi de la demande. `media.unavailable` identifie l’image ou l’icône indisponible après les essais. Les extractions partielles et le résultat de la vérification de disponibilité sont explicités dans les messages. Ces événements n’ajoutent aucune lecture ou écriture en base.

### Traces natives et confidentialité

Le code crée aussi des spans natifs avec des noms lisibles via `tracing.enterSpan`, compatibles avec Workers. `redact_query_string` est activé pour retirer les paramètres des URL collectées. Ils restent désactivés dans la configuration livrée : la télémétrie automatique Cloudflare enregistre notamment `url.full`, `url.path` et `url.query` des appels sortants. Telegram inclut le token du bot dans le chemin, et certaines lectures Prismic peuvent inclure un token dans la query. Le nettoyage de nos logs ne nettoie pas ces spans automatiques. Ne pas activer `observability.traces.enabled` avant de disposer d’une garantie de masquage ou d’une architecture qui retire ces secrets des URL instrumentées.

Le suivi par spans applicatifs dans les logs est actif immédiatement après déploiement ; ce n’est pas une waterfall native dans l’onglet Traces. Il fonctionne aussi sous `pnpm dev`, sans collecteur externe, SDK supplémentaire ni export des contenus. Nos événements excluent les messages Telegram, prompts, réponses LLM, contenu extrait, en-têtes, tokens et URL complètes. Les attributs natifs personnalisés utilisent les mêmes métadonnées sélectionnées.

Références : [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [spans personnalisés](https://developers.cloudflare.com/workers/observability/traces/custom-spans/), [attributs automatiques](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).

## Comptes et secrets

1. Créer un bot avec **@BotFather** dans Telegram. Copier son token dans `.dev.vars`.
2. Ouvrir une conversation privée avec ce bot et envoyer `/start`.
3. Avant de définir son webhook, exécuter `pnpm telegram:webhook identity`. Reporter uniquement vos propres `userId` et `chatId` dans `TELEGRAM_USER_ID` et `TELEGRAM_CHAT_ID`.

   Si `identity` signale un webhook actif (conflit 409), `pnpm telegram:webhook info` permet de l’inspecter. Pour transférer ce bot à cette application, retirer explicitement ce webhook avec `pnpm telegram:webhook unregister`, envoyer `/start` au bot, puis relancer `identity`. La suppression conserve les messages en attente mais interrompt la livraison à l’ancien service ; réactiver ensuite la réception avec `pnpm telegram:webhook register`. Si un autre programme utilise `getUpdates`, l’arrêter avant de relancer `identity`. La commande `identity` ne retire jamais automatiquement un webhook.

4. Générer `TELEGRAM_WEBHOOK_SECRET` avec `openssl rand -hex 32`.
5. Fournir `OPENAI_API_KEY`, `CONTEXT_DEV_API_KEY` et le **write token** `PRISMIC_WRITE_TOKEN`. Un éventuel `PRISMIC_ACCESS_TOKEN` est distinct : il sert à la lecture d’un repository privé.

Ne pas committer `.dev.vars`. La clé OpenAI utilise le modèle `OPENAI_MODEL`, par défaut `gpt-6-luna`, avec un effort de raisonnement `none`.

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

## Ligne éditoriale

Le bot adopte un regard technique de CTO sans première personne : intérêt concret, mécanismes, compromis et limites étayées, sans « je retiens », expérience inventée ou ton promotionnel. Le français conserve les termes usuels comme repository GitHub, pull request, code review ou framework. Chaque description comporte généralement deux courts paragraphes (un à trois autorisés), dans la limite totale de 800 caractères et 140 mots. Le Markdown met en valeur quelques idées en gras, une nuance en italique et, lorsque la source le permet, un micro-exemple exact en code inline sur une seule ligne. Aucune classe, commande ou API d'exemple n'est inventée pour enrichir la fiche.

Les paragraphes restent du Markdown littéral dans `summary` avec `spans: []`. Ils sont préservés dans Telegram, les pages de veille, les exports Markdown et le contenu HTML RSS. Le prompt du bot est autonome ; les workflows manuels historiques conservent leurs propres consignes.

## Utilisation

Envoyer par exemple :

```text
https://example.com/article
Insiste sur les usages pour une petite équipe frontend.
source: JavaScript Weekly
```

Après acceptation de la demande de publication par Prismic (HTTP 202), réponse de publication incertaine enregistrée, ou annulation, le workflow libère la fiche puis démarre immédiatement la suivante dans une étape durable. Il n’attend ni le cron ni un nouveau message ; le cron reste un filet de sécurité en cas d’échec. Les démarrages concurrents utilisent la même prise atomique D1 et le même identifiant de workflow.

Chaque message contenant un nouveau lien entre dans la file. Plusieurs URL dans le même message déclenchent un choix du lien principal. Les liens des messages suivants attendent la fin de la fiche active.

- `/aide` (ou `/help`) : aide complète.
- `/vider` : annuler les liens en attente uniquement, sans toucher à la fiche active.
- `/reset` : vider l’attente et demander l’annulation de la fiche active avant publication. Une migration commencée reste protégée ; utiliser `/reprendre`. Aucun document Prismic n’est supprimé.
- `/statut` : fiche active et éventuelle erreur.
- `/file` : fiches en cours et en attente.
- `/annuler` : annuler la fiche active avant le début de la migration.
- `/reprendre` : reprendre une extraction, un média ou une publication interrompus.

Le menu Telegram propose ces commandes dès que vous tapez `/`. Il est configuré par `pnpm telegram:webhook register`, ou séparément avec `pnpm telegram:webhook commands` sans modifier le webhook.

L’alerte de doublon propose « ✨ Créer une nouvelle proposition » et « 🗑 Annuler ». Les sélections déjà publiées affichent leur titre français avec un lien vers `/veille/liens/{uid-fr}`, en utilisant l’UID courant de Prismic et en regroupant les traductions FR/EN. Les soumissions encore dans la file sont signalées comme telles.

Les doublons sont cherchés parmi les documents **publiés** et les soumissions du bot. Les brouillons créés dans d’autres outils ne sont pas énumérables globalement avec la Content API. Les paramètres de suivi connus et fragments sont ignorés ; les paramètres fonctionnels et les chemins distincts sont conservés.

Pour un lien mis en attente, l’accusé de réception reste intact : l’image et la proposition sont envoyées en bas de la conversation lorsque son tour arrive. Cette distinction est conservée dans le journal D1, y compris après reprise. Les accusés historiques dont l’origine est inconnue sont également préservés.

Pour un lien traité immédiatement, le message « 🔖 Bien reçu ! » devient l’aperçu image via `editMessageMedia` dès que les médias sont prêts ; les textes FR/EN sont ensuite envoyés dans un message séparé avec les boutons. Sans image, cet accusé devient directement la proposition textuelle. Chaque correction textuelle reçoit immédiatement « ✍️ C’est noté ! Je prépare la nouvelle version. », puis ce message est édité avec la nouvelle proposition. Les révisions précédentes restent donc visibles. Les identifiants sont conservés dans le journal D1, séparément des états du Workflow ; une mise à jour rejouée ne renvoie pas l’accusé de réception. Si un message a été supprimé ou n’est plus éditable, le bot utilise un nouveau message. Un aperçu ou un message d’attente n’est jamais une cible de validation avant l’affichage des textes complets.

Pendant l’envoi, un seul message affiche la checklist des opérations réelles du client JS : image, icône, création FR/EN, contenus et demande de publication. Les données éditoriales, la version approuvée et le catalogue sont validés localement avant les écritures ; les deux IDs distincts et les références de médias retournés sont contrôlés avant la publication. Chaque écriture doit recevoir sa réponse SDK de réussite.

Après le HTTP 202, cette checklist devient « 🚀 Publication FR/EN acceptée par Prismic ! La mise en ligne se finalise ». Le contrôle de disponibilité est confié au cron : aucun polling ni sommeil de vérification dans le workflow. Les erreurs de progression Telegram ne relancent jamais une écriture Prismic. Une reprise ou un message supprimé conserve les règles de reçu durable. Le succès final remplace le message lorsque le cron constate les deux documents publiés.

Après une action acceptée (publication, annulation, correction, source, etc.), les boutons des messages précédents sont retirés ; les textes, images et références de réponse restent disponibles. Une action refusée laisse les boutons utilisables. Un échec Telegram lors du retrait est journalisé sans bloquer la publication ni la file.

Le bot affiche une proposition compacte dans un seul message formaté : titres FR/EN, résumés en citations avec leur Markdown inline, format précédé d’un emoji, sujets, 🔎 source de découverte et ✍️ crédit lorsque identifié, sans ligne de séparation. Le clavier normal contient **🔎 Choisir la source**, **🚀 Publier** et **🗑 Annuler**. Les dates, identifiants techniques et textes alternatifs ne sont pas affichés dans cette proposition ; ils restent conservés pour la publication. Les identifiants restent accessibles via `/statut` et dans les erreurs.

L’image est envoyée dès que l’extraction et le téléchargement des médias sont terminés, avant l’appel au LLM, une seule fois en aperçu photo (ou en fichier si son format n’est pas accepté comme photo). La favicon n’est plus envoyée dans le chat. Pendant l’extraction, le téléchargement des médias, l’envoi de l’aperçu et chaque tentative de génération (initiale ou correction), le statut Telegram « écrit… » est renouvelé toutes les quatre secondes, puis arrêté à la fin ou à l’échec de la tentative. Il n’est pas maintenu pendant les attentes humaines ou les délais de reprise. Un échec de cet indicateur est journalisé sans interrompre le LLM. L’aperçu seul ne permet pas d’approuver une fiche : l’accord doit viser la proposition FR/EN complète. Les originaux restent dans R2 pour l’import Prismic ; l’aperçu photo Telegram peut être recompressé. Après correction, seuls les textes sont renvoyés avec une courte introduction en italique indiquant la version et une note rédigée par le LLM dans le même appel structuré que les textes FR/EN, à partir de la proposition précédente et des consignes. Les actions directes de source ou de médias conservent une confirmation factuelle courte. Une nouvelle image déclenche un nouvel aperçu, tandis qu’un changement de texte ou de source ne renvoie pas l’image précédente.

Sans source fournie, la fiche reste à **Aucune** et peut être publiée immédiatement. **🔎 Choisir la source** remplace la proposition par les mêmes textes accompagnés de tous les boutons de sources et d’un bouton **Aucune source**. Le LLM renvoie le classement complet et une probabilité estimée par source, sans justification textuelle, dans le même appel que les textes FR/EN. Il tient compte du contexte et du dernier choix explicite de ce chat, mémorisé pendant 8 heures (y compris « Aucune source »), pour faciliter la sélection de plusieurs liens d’une newsletter. Les probabilités ne sont pas affichées et ne constituent pas une attribution. La source actuelle est cochée ; un clic met à jour le même message avec la nouvelle source et conserve le bouton de choix. Chaque changement invalide l’accord précédent. Sans classement, les sources sont affichées dans l’ordre du catalogue. Une source fournie explicitement est conservée.

Écrire les corrections directement dans le chat, ou répondre à la dernière fiche. « change la source » ouvre le catalogue et `source: JavaScript Weekly` sélectionne une source connue. « sans image » retire l’image. « valider », « publier » ou « oui » sont acceptés seulement en réponse à sa dernière version ; le bouton **🚀 Publier** produit le même accord. Une correction ou un changement de source invalide l’accord précédent. Un ancien bouton ou une réponse à une ancienne fiche est refusé.

Écrire « change l’image » propose les autres images extraites de la page, ainsi qu’une publication sans image. Le choix déclenche une nouvelle proposition à valider.

Un média indisponible doit être retenté ou faire l’objet d’une omission explicite avant validation. Le bot ne copie pas le nom de l’auteur de la page dans les crédits des images : leurs droits/attributions doivent être connus séparément.

## Reprises et limites

L’inbox Telegram est enregistrée avant HTTP 200. Le cron interne récupère les messages dont le traitement a été interrompu et démarre la prochaine fiche. Les événements Workflow sont des signaux de réveil ; D1 conserve les actions réelles. Les workflows continuent depuis D1 au bout de 30 cycles pour rester sous les limites de la plateforme.

Context.dev : trois tentatives, pauses de 5/15 secondes avec jitter et respect de `Retry-After`. Délai API/client 90/120 secondes, puis 180/210 après un timeout. Retries du SDK et des étapes englobantes désactivés. Les `success` individuels sont contrôlés même après HTTP 200. Les erreurs définitives s’arrêtent immédiatement ; une extraction exploitable et les bons médias sont conservés. Les journaux ne contiennent ni clé ni article complet.

Les fichiers sont limités à 10 Mio et les extractions à 220 000 caractères. Une extraction trop longue n’est pas tronquée silencieusement. Les URL doivent utiliser un nom de domaine HTTP(S) public ; les redirections des téléchargements sont validées à chaque saut. Les types de médias refusés par Prismic sont signalés pour omission ou reprise.

La publication est sérialisée et son accord porte sur une version exacte. Chaque réponse d’écriture Prismic est enregistrée avant d’être rendue au SDK. Une reprise reconstitue les références de migration en rejouant ces réponses connues ; elle ne réémet pas leurs POST/PUT. Une réponse perdue reste incertaine et bloque les écritures suivantes. Les refus 429 peuvent être retentés avec un budget durable.

Chaque minute, le cron traite au plus une entrée due de `publication_checks`, avec un bail de deux minutes contre les passages concurrents. Un seul appel SDK `getByIDs` (langues `*`, réponse limitée) vérifie les deux IDs et leurs locales FR/EN ; aucun texte, crédit, tag, relation ou média n’est recomparé après publication. Une absence relance le contrôle au prochain passage sans mettre la fiche en erreur. Une erreur réseau, d’authentification ou de quota est enregistrée séparément de `documents_not_available`. Le cron n’écrit aucun contenu dans Prismic et n’approuve aucune proposition humaine.

La fiche passe en `publication_pending` et libère la conversation dès l’acceptation. Le verrou de release reste détenu jusqu’à confirmation de disponibilité. La sélection suivante peut être extraite et corrigée ; si elle est déjà approuvée, elle reste en `waiting_publish_slot` sans commencer ses écritures. Le cron la réveille après libération du verrou. `/statut` et `/file` affichent également les confirmations en arrière-plan. Une erreur Telegram de confirmation n’empêche pas la libération du verrou et la notification est retentée séparément.

Une réponse de publication perdue passe en état `unknown` : le cron peut la confirmer par disponibilité des deux IDs, sans renvoyer la demande. Une incertitude sur une création de document ou un import média reste une erreur nécessitant la réconciliation opérateur décrite ci-dessous. Une publication refusée ou portant sur un nombre inattendu de documents reste également bloquée pour intervention ; sa release n’est pas libérée aveuglément.

Ces contrôles courts conviennent au cron des Workers gratuits. `timeout: "5 minutes"` est une limite configurée de nos étapes, pas une durée totale du Workflow. Les attentes réseau et `step.sleep` ne sont pas du temps CPU ; les limites CPU de l’offre gratuite restent applicables. Voir les [limites Workflows](https://developers.cloudflare.com/workflows/reference/limits/) et [limites Workers](https://developers.cloudflare.com/workers/platform/limits/). Appliquer `pnpm db:remote` avant le déploiement pour créer `publication_checks`.

L’acceptation et la confirmation concernent Prismic ; le site Astro attend sa reconstruction habituelle.

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

Si une tentative de création après une réponse perdue est refusée avec « There is already an existing translation in this language », retrouver la traduction via le sélecteur de langue de la fiche FR. Après vérification, `confirm-success` accepte aussi ce conflit précis avec la réponse `{ "id": "ID_REEL_DE_LA_TRADUCTION" }`. Il ne permet pas de marquer ce conflit retentable. Les réponses déjà connues des autres opérations restent réutilisées.

Chaque échec de traitement apparaît dans un nouveau message Telegram, avec le lien concerné. Le rejeu d’une même étape ne renvoie pas le message ; une nouvelle tentative de reprise peut signaler de nouveau l’erreur, même à version identique.

## Recette connectée

Après configuration et réservation de la migration :

1. Envoyer une page possédant auteur, image et favicon ; vérifier les crédits et les deux fichiers reçus.
2. Donner une correction et vérifier la nouvelle paire FR/EN ; essayer un ancien bouton de validation.
3. Choisir la source ou « Aucune », puis valider la dernière version.
4. Vérifier dans Prismic les deux langues liées, leurs images/icônes CDN, dimensions, textes alternatifs, résumés et dates.
5. Renvoyer le même lien pour vérifier la demande de confirmation de doublon.

La suite automatisée simule les fournisseurs. Une recette réelle, une livraison webhook ou un déploiement ne sont pas considérés vérifiés sur la seule base de ces tests.

Les reprises qui imposent au moins 30 secondes d’attente affichent leur délai estimé et l’heure de reprise en Europe/Brussels. Avant publication, ce message propose « 🗑 Annuler ». À la reprise, il est remplacé par une indication de reprise et son bouton est retiré. `/annuler` et `/reset` peuvent interrompre un workflow en attente de réessai : l’instance est arrêtée, puis une nouvelle génération traite l’annulation avant toute extraction. Le checkpoint de publication est relu après l’arrêt ; une migration commencée reste protégée et reprend via le journal existant. L’indisponibilité d’une notification d’attente est journalisée sans interrompre le traitement.

## Comparer les lectures de confirmation

Le benchmark est strictement en lecture seule sur une paire FR/EN déjà publiée :

```sh
node --env-file=.dev.vars scripts/benchmark-publication.mjs FR_DOCUMENT_ID EN_DOCUMENT_ID
```

Il chauffe les deux chemins, puis alterne cinq mesures de l’ancienne lecture complète (`getByID` pour chaque langue) et de la lecture allégée (`getByIDs` avec sélection des champs). Il indique les médianes de durée, nombre de requêtes et taille des réponses JSON décompressées. Les erreurs SDK ne sont pas affichées brut pour éviter les URL contenant un token. Ces mesures Node.js locales ne mesurent ni le CPU Cloudflare, ni le délai de propagation après une nouvelle publication, ni le temps de migration Prismic.
