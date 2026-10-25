# Veille Prismic depuis n8n

Deux exports autonomes, au choix :

- `n8n-curation.n8n.json` : mini formulaire avec **Lien** et **Note** facultative ; date du jour automatique.
- `n8n-curation-chat.n8n.json` : même agent depuis le chat n8n.

Le formulaire envoie le lien à un **AI Agent** n8n, connecté à **OpenAI Chat Model**, à l'outil HTTP **context_dev** et au **MCP officiel Prismic**. L'agent lit la source, rédige les fiches FR/EN, importe les images/favicons, renseigne les crédits disponibles et crée les traductions liées dans une release. Le bilan contient les résultats par lien et le lien vers la release.

Il ne recherche pas de doublons, ne consulte pas la bibliothèque de médias avant import et ne filtre pas les liens par sujet ou domaine. Chaque envoi traite un seul lien ; soumettre à nouveau le même lien est autorisé. Une extraction impossible est signalée sans inventer de résumé. Aucun outil de publication n'est exposé à l'agent.

## Importer

1. Dans un workflow n8n vide, utiliser **Import from File** et sélectionner le JSON, ou copier **tout le contenu JSON** et le coller sur le canevas.
2. Configurer les trois connexions ci-dessous dans les nœuds correspondants. Aucune clé n'est incluse dans l'export.
3. Dans **Formulaire**, ouvrir la **Test URL** après avoir lancé l'écoute du formulaire. Coller un seul lien et envoyer. Cette soumission crée directement les brouillons dans Prismic.
4. Activer/publier le workflow **dans n8n** pour utiliser la **Production URL** du formulaire. Cela ne publie pas les documents Prismic.
5. Le nœud natif **n8n Form**, configuré avec **Page Type → Form Ending**, affiche le bilan à la fin. Aucun nœud Respond to Webhook n’est utilisé. Il reste également disponible dans la sortie **Agent de veille** de l'exécution. Ouvrir la release dans Prismic pour relire et publier manuellement.

Les nœuds sont natifs, sans paquet communautaire, serveur intermédiaire ou accès au dépôt. Utiliser une version récente de n8n avec AI Agent 2.2 et MCP Client Tool 1.2 (transport Streamable HTTP). Les versions de nœuds sont enregistrées dans les exports.

## Connexions

| Nœud | Credential n8n | Valeur à renseigner |
| --- | --- | --- |
| OpenAI Chat Model | OpenAI | Votre clé API OpenAI ; modèle préconfiguré `gpt-4.1`, modifiable dans le nœud |
| context_dev | Header Auth | Name : `Authorization` ; Value : `Bearer VOTRE_CLE_CONTEXT_DEV` |
| Prismic MCP | Bearer Auth | Votre **write token** du repository `bd7d5fa0`, sans le préfixe `Bearer` |

L'adresse MCP est déjà renseignée : `https://mcp.prismic.io/mcp`. Le MCP doit être activé pour le repository dans Prismic. Le write token est documenté comme méthode d'authentification du MCP ; ce n'est pas un token de lecture Content API.

Le MCP expose seulement `list_releases`, `create_release`, `create_document`, `upload_asset` et `present_release`. Les locales, les 67 catégories, les 12 sources de découverte et les formes de champs sont préchargées dans `agent-prompt.md` (référence du 15 octobre 2026). Seule la liste des releases est consultée à chaque import pour réutiliser une release de veille. Si le catalogue ou le modèle change, actualiser ce fichier puis régénérer les exports.


## Règles éditoriales intégrées

- Titres originaux FR/EN ; chaque UID est le slug de son titre localisé.
- Résumés : un paragraphe de 2–3 phrases, généralement 50–100 mots, maximum 800 caractères et 140 mots. Markdown inline seulement : gras, italique, code et lien utile éventuel. Aucune liste.
- `selected_on` : date actuelle en Europe/Brussels, calculée automatiquement à chaque envoi. `published_on` : uniquement une date de publication fiable de la source.
- `source_language` : EN/FR pour la langue de la source, identique dans les deux traductions. Pour une autre langue, le champ reste vide et le bilan le signale.
- Catégories : consultation des topics Prismic existants ; 2–5 catégories pertinentes quand elles existent, sans création automatique ni catégorie sans rapport pour atteindre un quota.
- Médias : image/Open Graph/Twitter image et favicon Context.dev → `upload_asset` → champs `image` et `site_icon`. Aucun contrôle de doublon de média. Crédits renseignés uniquement si l'auteur ou l'éditeur est identifié.
- Une release de veille commune est réutilisée tant qu’elle est en attente. La seconde langue est créée avec `translationOfDocumentId`, pas comme document indépendant.

Le prompt fournit les formes éditeur Prismic vérifiées. Le Markdown est stocké comme texte dans le paragraphe `summary`, conformément au site.

## Variante chat

Importer `n8n-curation-chat.n8n.json`, connecter les mêmes credentials, puis ouvrir **Chat** dans l'éditeur n8n. Exemple :

> Ajoute ce lien à ma veille : https://example.com/article Mets l'accent sur les usages pour une petite équipe frontend.

Le chat exporté est privé (`public: false`) et sans mémoire : chaque message contient un seul lien et constitue une nouvelle demande d'import autonome, pour ne pas retraiter les liens d'un échange précédent. Pour un chat accessible hors de l'éditeur, régler l'accès dans le Chat Trigger n8n.

## Exploitation et limites vérifiées

L’agent dispose de 25 itérations d’outils pour traiter le lien soumis. Le nœud `attendre` permet de patienter après une limitation 429. Si le navigateur interrompt l’attente, consulter l’exécution n8n avant de soumettre à nouveau.

Les captures Context.dev sont demandées mais exclues de la réponse transmise au LLM (`url,markdown,metadata` seulement). Le contenu extrait et les réponses des outils peuvent rester dans les journaux d'exécution n8n : régler leur rétention selon vos besoins. Les clés restent dans les credentials.

Après une interruption, le bilan ou les sorties d'outils donnent les IDs déjà créés. Une nouvelle soumission peut recréer les fiches : c'est le comportement attendu sans déduplication. Ne pas considérer une paire partielle comme terminée. Les règles éditoriales sont des instructions à l'agent, pas un validateur déterministe ; relire la release avant publication.

**Validation locale :** JSON, connexions, expressions Context.dev, saisie d’un seul lien, date actuelle belge (y compris aux changements de jour), fin de formulaire native et sélection d'outils sans publication testés. Les paramètres ont été confrontés aux sources officielles n8n et à la documentation MCP Prismic. **Pas de test de bout en bout dans une instance n8n connectée** : aucune instance ni credential n8n n'a été fournie ; aucun document n'a été créé par ces exports pendant leur préparation.

## Maintenance

```sh
node apps/n8n-curation/build.mjs
node --test apps/n8n-curation/workflow.test.mjs
```

`agent-prompt.md` contient le prompt prêt à coller ; `build.mjs` le charge et génère les deux exports. Aucun changement au skill ni au site Astro n'est nécessaire.

Références : [MCP Prismic et authentification](https://prismic.io/docs/mcp), [HTTP Request n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [MCP Client Tool n8n](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/), [Form Trigger n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.formtrigger/).

## Release commune et publication quotidienne

Le workflow réutilise une release de veille existante, sinon crée `Veille — à publier`. Exécuter les imports successivement : le MCP ne fournit pas de création atomique conditionnelle. Les anciennes releases ne sont ni fusionnées ni supprimées.

Horaire souhaité : **chaque jour à 18 h, Europe/Brussels**. Le MCP actuel ne peut pas programmer cet horaire. Dans Prismic, ouvrir la release puis **Schedule**, choisir la prochaine échéance à 18 h et confirmer. Les imports suivants réutilisent cette release et conservent sa programmation. Après sa publication, la nouvelle release devra à nouveau être programmée : cet export ne met pas en place un ordonnanceur quotidien autonome. Le bilan distingue systématiquement une programmation réelle d’une date simplement souhaitée.
