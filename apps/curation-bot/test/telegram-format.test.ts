import { expect, it } from "vitest";
import { proposalHtml, telegramMarkdown } from "@/telegram-format";
import { keyboard } from "@/telegram";
import { formats } from "@/domain";
import { cats, draft, fixture } from "@test/fixtures";

it("renders Telegram inline HTML, quotes and escaped catalog labels", () => {
  const item = fixture();
  item.state.sourceUid = "javascript-weekly";
  item.state.draft!.fr.summary =
    '**React** avec *CSS* et `a < b` : [exemple](https://example.com/?a=1&b=2 "Titre").';
  const html = proposalHtml(item, cats);
  expect(html).toContain(`🇫🇷 <b>${draft.fr.title}</b>`);
  expect(html).toContain(
    "<blockquote><b>React</b> avec <i>CSS</i> et <code>a &lt; b</code>",
  );
  expect(html).toContain(
    '<a href="https://example.com/?a=1&amp;b=2">exemple</a>',
  );
  expect(html).toContain(
    "<b>🗒️ Article</b>\n🏷️ React · CSS\n🔎 Source : <b>JavaScript Weekly</b>",
  );
  expect(html).not.toContain("imageAlt");
  expect(html).not.toContain(draft.fr.imageAlt);
  expect(html).toContain("✍️ Crédit : <b>Jane Doe</b>");
  expect(html).not.toContain("─────");
  item.state.draft!.credit = "Jane <Doe> & co";
  expect(proposalHtml(item, cats)).toContain(
    "✍️ Crédit : <b>Jane &lt;Doe&gt; &amp; co</b>",
  );
  item.state.draft!.credit = null;
  expect(proposalHtml(item, cats)).not.toContain("✍️ Crédit");
  expect(html).not.toContain(item.id);
  expect(html).not.toContain(item.state.selectedOn);
  expect(html).not.toContain("Version 1");
  expect(
    proposalHtml(item, {
      ...cats,
      sources: [{ ...cats.sources[0], name: "<script>& source" }],
    }),
  ).toContain("&lt;script&gt;&amp; source");
  expect(
    keyboard(item, cats)
      .inline_keyboard.flat()
      .map((button) => button.text),
  ).toEqual(["🚀 Publier", "🗑 Annuler"]);
});
it("does not interpret untrusted HTML or unsafe links and separates code entities", () => {
  expect(
    telegramMarkdown("<b>text</b> & [bad](javascript:alert(1))"),
  ).not.toContain("<b>text</b>");
  expect(telegramMarkdown("[bad](http://example.com)")).not.toContain("<a ");
  expect(telegramMarkdown("**bold `code` text**")).toBe(
    "<b>bold </b><code>code</code><b> text</b>",
  );
});
it("displays the model revision note with its version, and maps every format to an emoji", () => {
  const item = fixture();
  const next = structuredClone(draft);
  next.fr.title = "React : variantes simplifiées";
  next.en.summary += " An additional detail.";
  item.state.revision = 2;
  item.state.revisionNote =
    "Titres raccourcis et résumés recentrés sur les usages en équipe.";
  item.state.draft = next;
  expect(proposalHtml(item, cats)).toMatch(
    /^<i>Version 2 — Titres raccourcis et résumés recentrés sur les usages en équipe\.<\/i>/,
  );
  for (const format of formats) {
    item.state.draft.format = format;
    expect(proposalHtml(item, cats)).toMatch(/<b>[^a-zA-Z<]+ [^<]+<\/b>\n🏷️/);
  }
});
