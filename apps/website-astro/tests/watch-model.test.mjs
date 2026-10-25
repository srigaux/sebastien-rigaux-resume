import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWatchData,
  buildLocalizedWatchData,
  watchLinkPath,
  watchLinkTarget,
  findPublishedTranslation,
  isCleanSlug,
  paginateLinks,
  watchPath,
} from "#watch-model";

const topic = { id: "topic-react", uid: "react", name: "React" };
const secondTopic = { id: "topic-ai", uid: "ai-agents", name: "AI Agents" };
const source = {
  id: "source-tldr",
  uid: "tldr-ai",
  name: "TLDR AI",
  url: "https://refer.tldr.tech/57571c42/2",
};

function link(id, overrides = {}) {
  return {
    id,
    uid: `link-${id}`,
    locale: "en",
    updatedAt: "2026-10-13T10:00:00Z",
    alternatePaths: { en: `/en/tech-watch/links/link-${id}` },
    title: `Link ${id}`,
    summary: "A useful technical resource.",
    url: `https://example.com/${id}`,
    selectedOn: "2026-10-12",
    firstPublishedAt: "2026-10-12T10:00:00Z",
    format: "Article",
    textLanguage: "en",
    topicIds: [topic.id],
    ...overrides,
  };
}

test("seeded topic and source UIDs are clean and unique", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../../../docs/tech-watch-seed.json", import.meta.url), "utf8"),
  );
  for (const collection of [seed.topics, seed.discoverySources]) {
    assert.ok(collection.every(({ uid }) => isCleanSlug(uid)));
    assert.equal(new Set(collection.map(({ uid }) => uid)).size, collection.length);
  }
  assert.equal(seed.topics.find(({ name }) => name === "C#").uid, "c-sharp");
  assert.equal(seed.topics.find(({ name }) => name === ".NET").uid, "dotnet");
});

test("prepared examples have original URLs and use the controlled vocabulary", async () => {
  const seed = JSON.parse(await readFile(new URL("../../../docs/tech-watch-seed.json", import.meta.url), "utf8"));
  const examples = JSON.parse(await readFile(new URL("../../../docs/tech-watch-examples.json", import.meta.url), "utf8"));
  const topicUids = new Set(seed.topics.map(({ uid }) => uid));
  const urls = new Set();
  for (const example of examples.curatedLinks) {
    assert.ok(isCleanSlug(example.uid));
    assert.equal(new URL(example.url).protocol, "https:");
    assert.ok(example.title && example.summary && example.selected_on);
    assert.ok(example.topics.length >= 2 && example.topics.length <= 5);
    assert.ok(example.topics.every((uid) => topicUids.has(uid)));
    assert.ok(!urls.has(example.url));
    urls.add(example.url);
  }
});

test("multiple topics and one free-text credit survive projection", () => {
  const data = buildWatchData(
    [topic, secondTopic],
    [source],
    [link("one", {
      credit: "Cassie Evans and Jack Doyle",
      sourceId: source.id,
      topicIds: [topic.id, secondTopic.id],
    })],
  );
  assert.deepEqual(data.links[0].topics.map(({ uid }) => uid), ["react", "ai-agents"]);
  assert.equal(data.links[0].credit, "Cassie Evans and Jack Doyle");
  assert.equal(data.links[0].discoveredVia?.name, "TLDR AI");
  assert.equal(data.links[0].image, undefined);
});

test("selection date orders links, with stable order within a day", () => {
  const data = buildWatchData(
    [topic],
    [],
    [
      link("older-day", { selectedOn: "2026-10-11" }),
      link("earlier", { firstPublishedAt: "2026-10-12T08:00:00Z" }),
      link("later", { firstPublishedAt: "2026-10-12T12:00:00Z" }),
    ],
  );
  assert.deepEqual(data.links.map(({ id }) => id), ["later", "earlier", "older-day"]);
});

test("pagination and bilingual archive paths stay aligned", () => {
  const data = buildWatchData(
    [topic],
    [],
    Array.from({ length: 31 }, (_, index) => link(String(index + 1))),
  );
  assert.equal(paginateLinks(data.links, 1).items.length, 20);
  assert.equal(paginateLinks(data.links, 2).items.length, 11);
  assert.equal(paginateLinks(data.links, 1).totalPages, 2);
  assert.deepEqual(
    [...paginateLinks(data.links, 1).items, ...paginateLinks(data.links, 2).items],
    data.links,
  );
  assert.equal(watchPath("fr", 2, "react"), "/veille/tags/react/page/2");
  assert.equal(watchPath("en", 2, "react"), "/en/tech-watch/tags/react/page/2");
});

test("English copy is selected only through the master's published translation ID", () => {
  const english = { id: "en-1", title: "English SEO title" };
  const other = { id: "en-other", title: "Unrelated title" };
  const translations = new Map([english, other].map((item) => [item.id, item]));
  assert.equal(findPublishedTranslation({ alternate_languages: [{ id: "en-1", lang: "en-us" }] }, "en-us", translations), english);
  assert.equal(findPublishedTranslation({ alternate_languages: [{ id: "en-1", lang: "en-us" }] }, "fr-be", translations), undefined);
  assert.equal(findPublishedTranslation({ alternate_languages: [{ id: "draft-1", lang: "en-us" }] }, "en-us", translations), undefined);
});

function translation(id, locale, uid, translationIds = {}, overrides = {}) {
  return link(id, { locale, textLanguage: locale, uid, translationIds, url: "https://example.com/shared", ...overrides });
}

test("localized slugs are paired by Prismic IDs and keep document-specific content", () => {
  const data = buildLocalizedWatchData([topic], [], [
    translation("fr-doc", "fr", "article-francais", { en: "en-doc" }, { title: "Titre français" }),
    translation("en-doc", "en", "english-article", { fr: "fr-doc" }, { title: "English title", updatedAt: "2026-10-14T12:00:00Z" }),
  ]);
  assert.equal(data.fr.links[0].title, "Titre français");
  assert.equal(data.en.links[0].title, "English title");
  assert.equal(data.en.links[0].id, "en-doc");
  assert.equal(data.en.links[0].updatedAt, "2026-10-14T12:00:00Z");
  const paths = { fr: "/veille/liens/article-francais", en: "/en/tech-watch/links/english-article" };
  assert.deepEqual(data.fr.links[0].alternatePaths, paths);
  assert.deepEqual(data.en.links[0].alternatePaths, paths);
  assert.equal(watchLinkTarget(data.fr.links[0], "en"), paths.en);
});

test("single-language entries remain listed in both languages and target the actual page", () => {
  for (const locale of ["fr", "en"]) {
    const missing = locale === "fr" ? "en" : "fr";
    const data = buildLocalizedWatchData([topic], [], [translation("only", locale, "only-published", { [missing]: "unpublished" })]);
    for (const listLocale of ["fr", "en"]) {
      assert.equal(data[listLocale].links.length, 1);
      assert.equal(data[listLocale].links[0].locale, locale);
      assert.deepEqual(data[listLocale].links[0].alternatePaths, { [locale]: watchLinkPath(locale, "only-published") });
      assert.equal(watchLinkTarget(data[listLocale].links[0], missing), watchLinkPath(locale, "only-published"));
    }
  }
});

test("identical UIDs and similar titles do not imply a translation relationship", () => {
  const data = buildLocalizedWatchData([topic], [], [
    translation("one", "fr", "same-slug", {}, { url: "https://example.com/one" }),
    translation("two", "en", "same-slug", {}, { url: "https://example.com/two" }),
  ]);
  assert.equal(data.fr.links.length, 2);
  assert.ok(data.fr.links.every((item) => Object.keys(item.alternatePaths).length === 1));
});

test("ambiguous language relationships and duplicate localized paths fail clearly", () => {
  assert.throws(() => buildLocalizedWatchData([topic], [], [
    translation("fr", "fr", "fr", { en: "not-en" }),
    translation("not-en", "fr", "other-fr"),
  ]), /Translation language mismatch/);
  assert.throws(() => buildWatchData([topic], [], [
    link("one", { uid: "same" }), link("two", { uid: "same" }),
  ]), /Duplicate curated link path/);
});

test("published Prismic UIDs with consecutive hyphens are preserved", () => {
  const uid = "argo-cd-autopilot--structurer-un-depot-gitops";
  const data = buildWatchData([topic], [], [link("legacy", { uid, locale: "fr" })]);
  assert.equal(data.links[0].uid, uid);
  assert.equal(watchLinkPath("fr", uid), `/veille/liens/${uid}`);
  assert.throws(() => buildWatchData([topic], [], [link("bad", { uid: "../bad" })]), /Invalid curated link UID/);
});

test("watch URLs omit trailing slashes on indexes, archives and details", () => {
  assert.equal(watchPath("fr"), "/veille");
  assert.equal(watchPath("en"), "/en/tech-watch");
  assert.equal(watchPath("fr", 2), "/veille/page/2");
  assert.equal(watchPath("en", 1, "react"), "/en/tech-watch/tags/react");
  assert.equal(watchLinkPath("fr", "mon-lien"), "/veille/liens/mon-lien");
});

// Invalid CMS dimensions must not produce an invented or unusable aspect ratio.
test("Prismic image dimensions survive normalization only as a valid pair", async () => {
  const { normalizeWatchImage } = await import("#watch-model");
  assert.deepEqual(normalizeWatchImage({ url: "https://images.example/photo", alt: "Photo", dimensions: { width: 1200, height: 800 } }),
    { url: "https://images.example/photo", alt: "Photo", width: 1200, height: 800 });
  for (const dimensions of [{ width: 0, height: 10 }, { width: Infinity, height: 10 }, { width: 10 }, { width: "10", height: 10 }]) {
    assert.deepEqual(normalizeWatchImage({ url: "https://images.example/photo", dimensions }), { url: "https://images.example/photo", alt: "" });
  }
  assert.equal(normalizeWatchImage(null), undefined);
  assert.equal(normalizeWatchImage({ url: "" }), undefined);
});
