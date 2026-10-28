import assert from "node:assert/strict";
import test from "node:test";
import { checkPublishedContent } from "../scripts/check-published-content.mjs";

const options = {
  repositoryName: "example",
  sourceRevision: "website-tree",
  eventName: "schedule",
  schedule: "17 */4 * * *",
  now: new Date("2026-10-28T12:00:00Z"),
};
const api = (ref = "published-v1") => Response.json({ refs: [{ ref: "draft", isMasterRef: false }, { ref, isMasterRef: true }] });
async function publishedFingerprint(overrides = {}) {
  return (await checkPublishedContent({ ...options, ...overrides, eventName: "push", fetcher: async () => api() })).fingerprint;
}

test("unchanged published content skips scheduled build", async () => {
  const fingerprint = await publishedFingerprint();
  const calls = [];
  const result = await checkPublishedContent({ ...options, fetcher: async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? api() : Response.json({ fingerprint });
  } });
  assert.equal(result.changed, false);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /deployment-state\.json\?check=/);
});

test("published ref, relevant source and annual refresh period each trigger a build", async () => {
  const fingerprint = await publishedFingerprint({ now: new Date("2026-01-31T23:00:00Z") });
  for (const overrides of [
    { ref: "published-v2", now: new Date("2026-01-31T23:00:00Z") },
    { sourceRevision: "changed-website-tree", now: new Date("2026-01-31T23:00:00Z") },
    { now: new Date("2026-02-01T00:00:00Z") },
  ]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, ...overrides, fetcher: async () => ++calls === 1 ? api(overrides.ref) : Response.json({ fingerprint }) });
    assert.equal(result.changed, true);
  }
});

test("push, manual and annual runs force a build without reading deployed state", async () => {
  for (const overrides of [{ eventName: "push" }, { eventName: "workflow_dispatch" }, { schedule: "0 6 1 2 *" }]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, ...overrides, fetcher: async () => { calls++; return api(); } });
    assert.equal(result.changed, true);
    assert.equal(calls, 1);
  }
});

test("missing or invalid deployed state bootstraps a build", async () => {
  for (const state of [new Response("missing", { status: 404 }), new Response("<html>404</html>"), Response.json(null), Response.json({})]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api() : state });
    assert.equal(result.changed, true);
  }
});

test("API errors and missing master ref fail the check", async () => {
  for (const response of [new Response("error", { status: 503 }), Response.json({ refs: [] })]) {
    await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => response }), /Prismic/);
  }
  let calls = 0;
  await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api() : new Response("error", { status: 503 }) }), /Deployed content check failed/);
  await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => { throw new Error("network error"); } }), /network error/);
});

test("a failed deployment leaves the old fingerprint and triggers another build", async () => {
  const fingerprint = await publishedFingerprint();
  for (let attempt = 0; attempt < 2; attempt++) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api("published-v2") : Response.json({ fingerprint }) });
    assert.equal(result.changed, true);
  }
});
