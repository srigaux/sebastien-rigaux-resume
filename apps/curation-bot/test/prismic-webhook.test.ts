import { env, createExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "@/index";
const bindings = {
  ...env,
  PRISMIC_WEBHOOK_SECRET: "private-secret",
  GITHUB_ACTIONS_TOKEN: "private-token",
};
const publication = {
  type: "api-update",
  domain: "bd7d5fa0",
  secret: "private-secret",
  masterRef: "new-master",
  documents: ["document-id"],
};
function send(payload: unknown = publication, overrides = {}) {
  return worker.fetch(
    new Request("https://worker.test/prismic/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    { ...bindings, ...overrides },
    createExecutionContext(),
  );
}
describe("Prismic rebuild webhook", () => {
  it.each([200, 204])(
    "dispatches published/unpublished documents, GitHub %s",
    async (status) => {
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      const fetcher = vi
        .mocked(fetch)
        .mockResolvedValue(new Response(null, { status }));
      expect((await send()).status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(
        "https://api.github.com/repos/srigaux/sebastien-rigaux-resume/actions/workflows/deploy.yml/dispatches",
      );
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer private-token",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        ref: "master",
        inputs: { run_title: expect.stringContaining("Prismic publication") },
      });
      expect(JSON.stringify(output.mock.calls)).not.toMatch(
        /private-secret|private-token|document-id|new-master/,
      );
    },
  );
  it("checks published content for an ambiguous release deletion", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      (
        await send({
          ...publication,
          documents: [],
          releases: { deletion: [{ ref: "release~old-master" }] },
        })
      ).status,
    ).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(
      "check-website-updates.yml/dispatches",
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual(
      { ref: "master" },
    );
  });
  it.each([
    { documents: [], releases: { update: [{ documents: ["draft"] }] } },
    { documents: [], releases: { addition: [{ documents: ["draft"] }] } },
    { type: "test", documents: [] },
    { masterRef: "" },
  ])("ignores unpublished changes %j", async (extra) => {
    expect(await (await send({ ...publication, ...extra })).text()).toBe(
      "Ignored",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [{ secret: "wrong" }, 401],
    [{ secret: null }, 401],
    [{ domain: "other" }, 403],
  ] as const)("rejects invalid credentials %j", async (extra, status) => {
    expect((await send({ ...publication, ...extra })).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and non-objects", async () => {
    expect(
      (
        await worker.fetch(
          new Request("https://worker.test/prismic/webhook", {
            method: "POST",
            body: "{",
          }),
          bindings,
          createExecutionContext(),
        )
      ).status,
    ).toBe(400);
    expect((await send(null)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies", async () => {
    expect((await send({ padding: "x".repeat(64001) })).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed without configuration", async () => {
    expect(
      (await send(publication, { GITHUB_ACTIONS_TOKEN: undefined })).status,
    ).toBe(503);
    expect(
      (await send(publication, { PRISMIC_WEBHOOK_SECRET: undefined })).status,
    ).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])(
    "returns retryable errors for GitHub %s",
    async (status) => {
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(fetch).mockResolvedValue(
        new Response("private-body", { status }),
      );
      expect((await send()).status).toBe(503);
      expect(JSON.stringify(output.mock.calls)).not.toContain("private-body");
    },
  );
  it("does not log network error messages", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValue(new Error("private-token"));
    expect((await send()).status).toBe(503);
    expect(JSON.stringify(output.mock.calls)).not.toContain("private-token");
  });
  it("rejects other methods", async () => {
    expect(
      (
        await worker.fetch(
          new Request("https://worker.test/prismic/webhook"),
          bindings,
          createExecutionContext(),
        )
      ).status,
    ).toBe(404);
  });
});
