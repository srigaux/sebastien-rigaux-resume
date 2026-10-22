import MarkdownIt from "markdown-it";
import type { Catalog, Draft, Item } from "@/domain";

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });
markdown.disable(["image", "autolink"]);
markdown.validateLink = (url) => /^https:\/\//i.test(url);
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// Render the parsed inline tokens to Telegram's HTML subset. Code entities may
// not overlap other entities, so suspend inline styles around each code span.
export function telegramMarkdown(value: string): string {
  return value
    .trim()
    .split(/\n[ \t]*\n+/)
    .map(telegramInline)
    .join("\n\n");
}
function telegramInline(value: string): string {
  const stack: { name: string; open: string }[] = [];
  return (markdown.parseInline(value, {})[0]?.children ?? [])
    .map((token) => {
      if (token.type === "code_inline")
        return (
          [...stack]
            .reverse()
            .map((tag) => `</${tag.name}>`)
            .join("") +
          `<code>${escapeHtml(token.content)}</code>` +
          stack.map((tag) => tag.open).join("")
        );
      const tags: Record<string, string> = {
        strong: "b",
        em: "i",
        s: "s",
        link: "a",
      };
      const type = token.type.replace(/_(open|close)$/, "");
      if (token.nesting === 1 && tags[type]) {
        const name = tags[type];
        const open =
          name === "a"
            ? `<a href="${escapeHtml(String(token.attrGet("href") ?? ""))}">`
            : `<${name}>`;
        stack.push({ name, open });
        return open;
      }
      if (token.nesting === -1 && tags[type]) return `</${stack.pop()!.name}>`;
      return token.type === "softbreak" || token.type === "hardbreak"
        ? " "
        : escapeHtml(token.content);
    })
    .join("");
}
const formats: Record<Draft["format"], string> = {
  Article: "🗒️ Article",
  Video: "🎬 Vidéo",
  Repository: "📦 Repository",
  Release: "🚀 Nouveauté",
  Documentation: "📚 Documentation",
  Tool: "🛠️ Outil",
  Other: "🔎 Ressource",
};
export function proposalHtml(item: Item, cats: Catalog): string {
  const s = item.state,
    draft = s.draft!;
  const source =
    s.sourceUid == null
      ? "Aucune"
      : (cats.sources.find((entry) => entry.uid === s.sourceUid)?.name ??
        s.sourceUid);
  const topics = draft.topics.map((uid) =>
    escapeHtml(
      (cats.topics.find((entry) => entry.uid === uid)?.name ?? uid).slice(
        0,
        160,
      ),
    ),
  );
  return [
    ...(s.revision > 1
      ? [
          `<i>Version ${s.revision} — ${escapeHtml(s.revisionNote ?? "Proposition prête à relire.")}</i>`,
          "",
        ]
      : []),
    `🇫🇷 <b>${escapeHtml(draft.fr.title)}</b>`,
    `<blockquote>${telegramMarkdown(draft.fr.summary)}</blockquote>`,
    "",
    `🇬🇧 <b>${escapeHtml(draft.en.title)}</b>`,
    `<blockquote>${telegramMarkdown(draft.en.summary)}</blockquote>`,
    "",
    `<b>${formats[draft.format]}</b>`,
    `🏷️ ${topics.join(" · ")}`,
    `🔎 Source : <b>${escapeHtml(source.slice(0, 200))}</b>`,
    ...(draft.credit?.trim()
      ? [`✍️ Crédit : <b>${escapeHtml(draft.credit.trim())}</b>`]
      : []),
    ...(s.media?.failures.length
      ? [
          "",
          "⚠️ Un média est indisponible. Réessayez ou confirmez son omission.",
        ]
      : []),
  ].join("\n");
}

export function duplicateHtml(item: Item): string {
  const matches = (item.state.duplicateMatches ?? []).map((match) => {
    if (typeof match === "string") return `• ${escapeHtml(match)}`;
    const title = escapeHtml(match.title);
    return match.url && /^https:\/\//i.test(match.url)
      ? `• <a href="${escapeHtml(match.url)}">${title}</a>`
      : `• ${title}`;
  });
  return [
    "🔎 <b>Ce lien a déjà été repéré !</b>",
    matches.join("\n"),
    "Tu peux consulter la sélection existante ou continuer pour préparer une nouvelle proposition. Rien ne sera publié sans ta confirmation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
