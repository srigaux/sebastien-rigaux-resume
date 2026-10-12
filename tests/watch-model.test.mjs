import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWatchData,
  isCleanSlug,
  paginateLinks,
  watchPath,
} from "../src/lib/watch-model.ts";

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
    title: `Link ${id}`,
    summary: "A useful technical resource.",
    url: `https://example.com/${id}`,
    selectedOn: "2026-10-12",
    firstPublishedAt: "2026-10-12T10:00:00Z",
    format: "Article",
    topicIds: [topic.id],
    ...overrides,
  };
}

test("seeded topic and source UIDs are clean and unique", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../docs/tech-watch-seed.json", import.meta.url), "utf8"),
  );
  for (const collection of [seed.topics, seed.discoverySources]) {
    assert.ok(collection.every(({ uid }) => isCleanSlug(uid)));
    assert.equal(new Set(collection.map(({ uid }) => uid)).size, collection.length);
  }
  assert.equal(seed.topics.find(({ name }) => name === "C#").uid, "c-sharp");
  assert.equal(seed.topics.find(({ name }) => name === ".NET").uid, "dotnet");
});

test("prepared examples have original URLs and use the controlled vocabulary", async () => {
  const seed = JSON.parse(await readFile(new URL("../docs/tech-watch-seed.json", import.meta.url), "utf8"));
  const examples = JSON.parse(await readFile(new URL("../docs/tech-watch-examples.json", import.meta.url), "utf8"));
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

test("tracking parameters do not create duplicate public links", () => {
  assert.throws(
    () => buildWatchData([topic], [], [
      link("one", { url: "https://example.com/article?utm_source=email" }),
      link("two", { url: "https://example.com/article" }),
    ]),
    /Duplicate curated link URL/,
  );
});

test("pagination and bilingual archive paths stay aligned", () => {
  const data = buildWatchData(
    [topic],
    [],
    Array.from({ length: 31 }, (_, index) => link(String(index + 1))),
  );
  assert.equal(paginateLinks(data.links, 1).items.length, 30);
  assert.equal(paginateLinks(data.links, 2).items.length, 1);
  assert.equal(watchPath("fr", 2, "react"), "/veille/tags/react/page/2/");
  assert.equal(watchPath("en", 2, "react"), "/en/tech-watch/tags/react/page/2/");
});
