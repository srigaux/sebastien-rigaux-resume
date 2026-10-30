import { escapeHtml } from "@/telegram-format";

export const QUEUE_PAGE_SIZE = 8;
export type QueueRow = {
  id: string;
  status: string;
  active: number;
  title: string | null;
  url: string | null;
  publication_check_status: string | null;
  total_count: number;
  blocked: number;
};
function label(row: QueueRow): [string, string] {
  if (row.status === "publication_pending")
    return row.publication_check_status === "attention"
      ? [
          "⚠️ À débloquer dans Prismic",
          `Vérifications en pause · /reprendre ${row.id}`,
        ]
      : ["🚀 Mise en ligne", "Vérification des versions française et anglaise"];
  if (row.status === "error")
    return ["⚠️ À reprendre", `Traitement en pause · /reprendre ${row.id}`];
  if (row.status === "waiting_publish_slot")
    return [
      "✅ Validés, prêts à publier",
      "Publication automatique dès que Prismic est disponible",
    ];
  if (row.status === "review")
    return ["👀 À valider", "Ta proposition attend ta réponse dans Telegram"];
  if (row.status === "source")
    return ["👀 À valider", "Choix de la source attendu"];
  if (row.status === "choose")
    return ["👀 À valider", "Choisis le lien à préparer"];
  if (row.status === "duplicate")
    return ["👀 À valider", "Doublon détecté : continuer ou annuler ?"];
  if (row.status === "publishing")
    return ["🚀 Mise en ligne", "Envoi des versions française et anglaise"];
  return row.active
    ? ["✍️ En préparation", "Je prépare la proposition"]
    : ["📥 À préparer", "Dans l’ordre de réception"];
}
function title(row: QueueRow) {
  const text = row.title?.trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 110);
  try {
    const url = new URL(row.url ?? "");
    if (["http:", "https:"].includes(url.protocol))
      return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(
        0,
        110,
      );
  } catch {
    /* Legacy incomplete state. */
  }
  return "Lien sans titre pour le moment";
}
export function queueHtml(rows: QueueRow[], page: number) {
  if (!rows.length)
    return {
      text:
        page === 1
          ? "📭 Ta file est vide.\nEnvoie-moi un lien pour préparer une nouvelle sélection."
          : "Cette page est vide. Reviens à /file pour voir les liens en attente.",
      pages: 1,
    };
  const total = rows[0].total_count;
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const [group, status] = label(row);
    const entries = groups.get(group) ?? [];
    entries.push(
      `<b>${escapeHtml(title(row))}</b>\n${escapeHtml(status)}\n<code>${escapeHtml(row.id)}</code>`,
    );
    groups.set(group, entries);
  }
  const pages = Math.ceil(total / QUEUE_PAGE_SIZE);
  const text = [
    `<b>📚 Ta file · ${total} lien${total > 1 ? "s" : ""}</b>`,
    [...groups]
      .map(
        ([group, entries]) =>
          `${group}\n\n${entries.join("\n\n────────────\n\n")}`,
      )
      .join("\n\n────────────\n\n"),
    ...(rows[0].blocked
      ? [
          "💡 Une publication attend une intervention dans Prismic. Tu peux continuer à préparer et valider les autres liens ; leur publication attendra la résolution du blocage.",
        ]
      : []),
    "Pour valider ou corriger, utilise la dernière proposition.\nPour retirer un lien validé en attente : /annuler suivi de son identifiant.",
    ...(pages > 1
      ? [`Page ${page}/${pages} · /file ${page < pages ? page + 1 : 1}`]
      : []),
  ].join("\n\n");
  return { text, pages };
}
