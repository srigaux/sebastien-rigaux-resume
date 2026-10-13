import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { extractScrapeResult, scrape } from "#curate-scrape";
import { duplicateKey, prepareMigration, sendDraft, slugFromTitle, validateDraft } from "#curate-send";
import { renderSummaryMarkdown } from "#watch-markdown";

const rawDraft = {
  canonicalUrl: "https://example.com/blog/design-sync/?utm_source=newsletter",
  sourceLanguage: "EN",
  format: "Article",
  topics: ["design-systems", "react"],
  publishedOn: "2026-09-28",
  credit: "Nitay Neeman",
  fr: {
    title: "Synchroniser ses composants React avec Claude Design",
    summary: "Une méthode concrète pour transférer un design system React vers Claude Design, avec styles compilés et vérification dans Storybook.",
  },
  en: {
    title: "Bring a React design system into Claude Design",
    summary: "A practical guide to syncing real React components with Claude Design, including compiled styles and visual checks in Storybook.",
  },
};

test("scraping uses the requested Context.dev options and omits screenshot base64", async () => {
  let body;
  const response = {
    url: rawDraft.canonicalUrl,
    markdown: { success: true, data: "# Article\n\nUseful content." },
    screenshot: { success: true, data: "data:image/png;base64,aGVsbG8=" },
    metadata: { title: "Article", author: "Nitay Neeman", favicon: "https://example.com/favicon.png" },
  };
  const result = await scrape(rawDraft.canonicalUrl, {
    fresh: true,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, "Bearer test-key");
      return { ok: true, json: async () => response };
    },
  });
  assert.deepEqual(body.formats, { markdown: true, screenshot: true });
  assert.deepEqual(body.sharedParams, { dismissPopups: true, settleAnimations: true, mainContentOnly: true });
  assert.deepEqual(body.markdownParams, { includeLinks: false });
  assert.equal(body.maxAgeMs, 0);
  assert.equal(result.metadata.author, "Nitay Neeman");
  assert.equal(result.markdown, response.markdown.data);
  assert.ok(!JSON.stringify(result).includes("aGVsbG8="));
  assert.equal((await readFile(result.screenshotPath)).toString(), "hello");
  await rm(dirname(result.screenshotPath), { recursive: true });
});

test("scrape result requires readable Markdown", async () => {
  await assert.rejects(extractScrapeResult({ url: "https://example.com/", markdown: { success: false, data: null } }), /usable Markdown/);
});

test("draft validation accepts a fuller prose overview and rejects list summaries", () => {
  const draft = validateDraft(rawDraft);
  assert.equal(draft.sourceLanguage, "EN");
  assert.equal(draft.publishedOn, "2026-09-28");
  assert.match(draft.selectedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => validateDraft({ ...rawDraft, fr: { ...rawDraft.fr, summary: "A".repeat(801) } }), /summary/);
  assert.throws(() => validateDraft({ ...rawDraft, fr: { ...rawDraft.fr, summary: "• One artificial bullet item that should be plain prose instead." } }), /summary/);
  assert.doesNotThrow(() => validateDraft({ ...rawDraft, fr: { ...rawDraft.fr, summary: `${rawDraft.fr.summary} Ce passage ajoute un détail utile. **À retenir** : les styles compilés peuvent aussi être vérifiés avec \`Storybook\`.` } }));
  assert.throws(() => validateDraft({ ...rawDraft, sourceLanguage: "DE" }), /sourceLanguage/);
  assert.equal(duplicateKey("https://example.com/a?utm_source=x#section"), "https://example.com/a");
});

test("migration stages a French master and a linked English translation", () => {
  const created = [];
  const migration = {
    createDocument(document, title, params) {
      const item = { document, title, params };
      created.push(item);
      return item;
    },
  };
  const topics = rawDraft.topics.map((uid) => ({ id: uid, uid }));
  const draft = validateDraft(rawDraft);
  prepareMigration(draft, { topics, sources: [], migration });
  assert.equal(created.length, 2);
  assert.equal(created[0].document.lang, "fr-be");
  assert.equal(created[1].document.lang, "en-us");
  assert.equal(created[1].params.masterLanguageDocument, created[0]);
  assert.equal(created[0].document.data.source_language, "EN");
  assert.equal(created[1].document.data.source_language, "EN");
  assert.equal(created[0].document.data.summary[0].text, draft.fr.summary);
  assert.equal(created[1].document.data.summary[0].text, draft.en.summary);
  assert.equal(created[0].document.data.topics.length, 2);
  assert.equal(created[0].document.uid, slugFromTitle(draft.fr.title));
  assert.equal(created[1].document.uid, slugFromTitle(draft.en.title));
});

test("published duplicate prevents a Prismic write", async () => {
  let migrated = false;
  const client = {
    getRepository: async () => ({ languages: [{ id: "fr-be", is_master: true }, { id: "en-us", is_master: false }] }),
    getAllByType: async (type) => type === "curated_link"
      ? [{ id: "existing", data: { url: { url: "https://example.com/blog/design-sync/" } } }]
      : [],
    migrate: async () => { migrated = true; },
  };
  await assert.rejects(sendDraft(validateDraft(rawDraft), { writeToken: "test-key", clientFactory: () => client }), /already exists/);
  assert.equal(migrated, false);
});

test("direct sender prepares two linked drafts and never publishes them", async () => {
  let migrated = false;
  const client = {
    getRepository: async () => ({ languages: [{ id: "fr-be", is_master: true }, { id: "en-us", is_master: false }] }),
    getAllByType: async (type) => type === "topic"
      ? rawDraft.topics.map((uid) => ({ id: uid, uid }))
      : [],
    migrate: async (migration, { reporter }) => {
      migrated = true;
      assert.equal(migration._documents.length, 2);
      assert.equal(migration._documents[1].masterLanguageDocument, migration._documents[0]);
      reporter({ type: "end", data: { migrated: { documents: 2, assets: 0 } } });
    },
    publishMigrationRelease: () => { throw new Error("must not publish"); },
  };
  const result = await sendDraft(validateDraft(rawDraft), { writeToken: "test-key", clientFactory: () => client });
  assert.equal(migrated, true);
  assert.equal(result.status, "migration-release-draft");
  assert.equal(result.uids.fr, slugFromTitle(rawDraft.fr.title));
  assert.equal(result.uids.en, slugFromTitle(rawDraft.en.title));
});

test("summary Markdown renders inline formatting without HTML injection", () => {
  const html = renderSummaryMarkdown("Read **the guide**, *carefully*, with `inline code` and [details](https://example.com). <script>alert(1)</script> [bad](javascript:alert(1))");
  assert.match(html, /<strong>the guide<\/strong>/);
  assert.match(html, /<em>carefully<\/em>/);
  assert.match(html, /<code>inline code<\/code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
});
