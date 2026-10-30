import { expect, it } from "vitest";
import {
  proposalHtml,
  telegramMarkdown,
  duplicateHtml,
  publicationChecklist,
} from "@/telegram-format";
import { keyboard, sourceKeyboard, formatKeyboard } from "@/telegram";
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
  ).toEqual(["🟨 JavaScript Weekly", "🗒️ Article", "🗑 Annuler", "🚀 Publier"]);
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

it("keeps a source chooser and ranks all sources without attributing one", () => {
  const item = fixture();
  const catalog = {
    ...cats,
    sources: [
      ...cats.sources,
      { id: "src-css", uid: "css-weekly", name: "CSS Weekly" },
      { id: "src-react", uid: "react-status", name: "React Status" },
    ],
  };
  item.state.sourceUid = null;
  item.state.draft!.sourceRanking = [
    { uid: "javascript-weekly", probability: 0.2 },
    { uid: "css-weekly", probability: 0.8 },
    { uid: "react-status", probability: 0.1 },
  ];
  expect(
    keyboard(item, catalog).inline_keyboard.map((row) =>
      row.map((button) => button.text),
    ),
  ).toEqual([
    ["🔎 Choisir la source", "🗒️ Article"],
    ["🗑 Annuler", "🚀 Publier"],
  ]);
  expect(
    sourceKeyboard(item, catalog)
      .inline_keyboard.flat()
      .map((b) => b.text),
  ).toEqual([
    "⚛️ React Status",
    "🟨 JavaScript Weekly",
    "🎨 CSS Weekly",
    "✓ Aucun",
  ]);
  expect(item.state.sourceUid).toBeNull();
  item.state.sourceUid = "css-weekly";
  expect(sourceKeyboard(item, catalog).inline_keyboard[2][0]).toMatchObject({
    text: "🎨 ✓ CSS Weekly",
    callback_data: `${item.id}:1:source:src-css`,
  });
  expect(keyboard(item, catalog).inline_keyboard[0][0].text).toBe(
    "🎨 CSS Weekly",
  );
  delete item.state.draft!.sourceRanking;
  expect(
    sourceKeyboard(item, catalog)
      .inline_keyboard.flat()
      .map((b) => b.text),
  ).toEqual([
    "🟨 JavaScript Weekly",
    "🎨 ✓ CSS Weekly",
    "⚛️ React Status",
    "Aucun",
  ]);
});

it("keeps paragraph breaks and inline micro-examples in a single Telegram quotation", () => {
  const item = fixture();
  item.state.draft!.fr.summary =
    "Un **repository GitHub** avec des états explicites.\n\nLa classe `flex items-center gap-2` rend cet exemple concret.";
  expect(proposalHtml(item, cats)).toContain(
    "<blockquote>Un <b>repository GitHub</b> avec des états explicites.\n\nLa classe <code>flex items-center gap-2</code> rend cet exemple concret.</blockquote>",
  );
});

it("présente les doublons avec un lien FR échappé et des boutons explicites", () => {
  const item = fixture();
  item.status = "duplicate";
  item.state.duplicateMatches = [
    {
      title: "React <Core> & TypeScript",
      url: "https://sebastien.rigaux.be/veille/liens/react-core",
    },
  ];
  const html = duplicateHtml(item);
  expect(html).toContain("🔎 <b>Ce lien a déjà été repéré !</b>");
  expect(html).toContain(
    '<a href="https://sebastien.rigaux.be/veille/liens/react-core">React &lt;Core&gt; &amp; TypeScript</a>',
  );
  expect(html).toContain("Rien ne sera publié sans ta confirmation");
  const buttons = keyboard(item, cats).inline_keyboard.flat();
  expect(buttons.map((button) => button.text)).toEqual([
    "✨ Créer une nouvelle proposition",
    "🗑 Annuler",
  ]);
  item.state.duplicateMatches = ["Ancienne fiche"];
  expect(duplicateHtml(item)).toContain("Ancienne fiche");
});

it("affiche les médias terminés, la fiche FR en cours et les étapes suivantes en attente", () => {
  const item = fixture();
  const media = {
    key: "preview",
    url: "https://example.com/image.png",
    filename: "image.png",
    mime: "image/png",
    size: 3,
  };
  item.state.media = {
    image: media,
    icon: { ...media, key: "icon" },
    failures: [],
  };
  const checklist = publicationChecklist(item, "create-fr");
  expect(checklist.text).toContain("✅ Import de l’image");
  expect(checklist.text).toContain("✅ Import de l’icône du site");
  expect(checklist.text).toContain("⏳ Création de la fiche FR 🇫🇷");
  expect(checklist.text).toContain("▫️ Création de la fiche EN 🇬🇧");
  expect(checklist.text).toContain("▫️ Publication dans Prismic");
  const paused = publicationChecklist(
    item,
    "paused",
    checklist.done,
    checklist.stage,
  );
  expect(paused.text).toContain("✅ Import de l’image");
  expect(paused.text).toContain("⚠️ Création de la fiche FR");
  expect(paused.text).toContain("nouveau message ci-dessous");
});
it("omet les médias absents et ne coche pas une demande de publication encore incertaine", () => {
  const item = fixture();
  const pending = publicationChecklist(
    item,
    "verify",
    [],
    undefined,
    "⏱ 30 s écoulées.",
  );
  expect(pending.text).not.toContain("Import de l’");
  expect(pending.text).toContain("✅ Enregistrement des textes");
  expect(pending.text).toContain("▫️ Publication dans Prismic");
  expect(pending.text).toContain("⏳ Vérification des deux versions");
  expect(pending.text).toContain("30 s");
  item.state.publicationRequested = true;
  expect(publicationChecklist(item, "verify").text).toContain(
    "✅ Publication dans Prismic",
  );
});

it("orders all formats with the likeliest at the bottom and Other last", () => {
  const item = fixture();
  item.state.draft!.format = "Release";
  item.state.draft!.formatRanking = [
    { format: "Release", probability: 0.9 },
    { format: "Article", probability: 0.8 },
    { format: "Other", probability: 1 },
  ];
  const buttons = formatKeyboard(item).inline_keyboard.flat();
  expect(buttons).toHaveLength(7);
  expect(buttons.slice(-3).map((b) => b.text)).toEqual([
    "🗒️ Article",
    "✓ 🚀 Release",
    "🧩 Autre",
  ]);
  expect(buttons.at(-2)).toMatchObject({
    callback_data: `${item.id}:1:format:Release`,
  });
  delete item.state.draft!.formatRanking;
  expect(formatKeyboard(item).inline_keyboard.flat()).toHaveLength(7);
});
