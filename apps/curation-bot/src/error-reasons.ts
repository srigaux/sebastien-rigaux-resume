// Static, reviewed diagnostic text. Never derive log messages from provider bodies.
export const reasons = {
  write_unknown:
    "Réponse d’écriture inconnue ; rapprochement nécessaire avant reprise pour éviter un doublon",
  translation_exists:
    "Une traduction existe déjà ; rapprocher son identifiant avant reprise",
  media_rejected: "Média refusé ; remplacement ou omission à confirmer",
  media_missing: "Média enregistré introuvable ; intervention nécessaire",
  catalog_empty: "Catalogue des sujets ou sources vide ou inaccessible",
  catalog_changed:
    "Catalogue modifié ; corriger la proposition avant publication",
  draft_invalid: "Proposition éditoriale invalide ; correction nécessaire",
  publication_disabled: "Publication désactivée dans la configuration",
  migration_incomplete:
    "Brouillons ou médias incomplets ; publication interrompue",
  publication_count:
    "Nombre inattendu de documents mis en publication ; vérification nécessaire",
  remote_rejected:
    "Écriture refusée ; vérifier les droits et les données avant reprise",
  rate_limited: "Limite du service atteinte",
  timeout: "Délai de réponse du service dépassé",
  network: "Connexion au service interrompue",
  remote_failed: "Service distant indisponible",
  business_rule:
    "Traitement interrompu par une règle métier ; consulter le message de la fiche dans Telegram",
} as const;
export type ReasonCode = keyof typeof reasons;
export function reasonCode(value: unknown): ReasonCode | undefined {
  return typeof value === "string" && Object.hasOwn(reasons, value)
    ? (value as ReasonCode)
    : undefined;
}
