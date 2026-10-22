import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { collectMedia, scrape } from "@/extract";
import { generateDraft } from "@/editor";
import { migrate, publish, verifyPublication } from "@/prismic";
import { cats, draft, extraction, fixture, repository } from "@test/fixtures";
import { type Steps } from "@/retry";
const steps = () =>
  ({
    do: vi.fn(async (_n: string, _c: unknown, fn: () => Promise<unknown>) =>
      fn(),
    ),
    sleep: vi.fn(async () => {}),
  }) as unknown as Steps;

it("utilise le SDK Context.dev avec un délai API inférieur au délai client et zéro retry interne", async () => {
  const bodies: Record<string, unknown>[] = [];
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      attempts++;
      if (attempts === 1) return new Response("{}", { status: 408 });
      return Response.json({
        url: extraction.url,
        markdown: { success: true, data: extraction.markdown },
        metadata: { author: "Jane Doe" },
        request_id: "ctx-1",
      });
    }),
  );
  const result = await scrape(env, steps(), "ctx", extraction.url);
  expect(result.author?.name).toBe("Jane Doe");
  expect(attempts).toBe(2);
  expect(bodies[0]).toMatchObject({
    timeoutOpts: { milliseconds: 90000 },
    formats: { markdown: true, images: true },
  });
  expect(bodies[1]).toMatchObject({
    timeoutOpts: { milliseconds: 180000 },
    maxAgeMs: 0,
  });
});
it("conserve les bons médias dans R2 et ne retélécharge que celui en échec", async () => {
  let iconCalls = 0,
    imageCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      if (String(input).includes("icon")) {
        iconCalls++;
        return new Response("", { status: 404 });
      }
      imageCalls++;
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    }),
  );
  const first = await collectMedia(env, steps(), "media-test", extraction);
  expect(first.image?.size).toBe(3);
  expect(first.failures[0].kind).toBe("icon");
  expect((await env.BUCKET.get(first.image!.key))?.size).toBe(3);
  await collectMedia(env, steps(), "media-test-retry", extraction, first);
  expect(imageCalls).toBe(1);
  expect(iconCalls).toBe(2);
});
it("envoie le contexte complet à OpenAI et rejette un crédit sans preuve", async () => {
  const item = fixture();
  item.state.instructions = ["Insiste sur la lisibilité."];
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      const proposal = {
        ...draft,
        credit: "Invented Person",
        creditEvidence: "unsupported",
      };
      return Response.json({
        id: "resp_test",
        object: "response",
        created_at: 1,
        model: "gpt-5-mini",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(proposal),
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
    }),
  );
  const result = await generateDraft(env, item, extraction, cats);
  expect(result.credit).toBeNull();
  expect(JSON.stringify(body)).toContain("Insiste sur la lisibilité.");
  expect(JSON.stringify(body)).toContain(extraction.markdown);
  expect(JSON.stringify(body)).toContain(draft.fr.title);
  expect(body.model).toBe("gpt-5-mini");
});
it("importe réellement deux médias via le SDK officiel, lie EN à FR et reprend sans duplication", async () => {
  const item = fixture();
  for (const kind of ["image", "icon"] as const) {
    const key = `sdk/${kind}`;
    await env.BUCKET.put(key, new Uint8Array([1, 2, 3]));
    item.state.media![kind] = {
      key,
      url: `https://example.com/${kind}.png`,
      mime: "image/png",
      filename: `${kind}.png`,
      size: 3,
    };
  }
  const puts: Record<string, any>[] = [];
  const creates: Record<string, any>[] = [];
  let assetCount = 0,
    publishCount = 0,
    rejectedEn = false;
  const assets: Record<string, any> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (
        url.includes("cdn.prismic.io/api/v2") &&
        !url.includes("documents/search")
      )
        return Response.json(repository);
      if (url.includes("/assets") && init?.method === "POST") {
        const form = init.body as FormData;
        const file = form.get("file") as File;
        const value = {
          id: `asset-${++assetCount}`,
          url: `https://images.prismic.io/repo/${file.name}`,
          width: 64,
          height: 64,
        };
        assets[file.name] = value;
        return Response.json(value);
      }
      if (url.endsWith("/documents") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.lang === "en-us" && !rejectedEn) {
          rejectedEn = true;
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "1" },
          });
        }
        creates.push(body);
        return Response.json(
          { id: body.lang === "fr-be" ? "fr-id" : "en-id" },
          { status: 201 },
        );
      }
      if (url.includes("/documents/") && init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return Response.json({});
      }
      if (url.includes("migration-release/publish")) {
        publishCount++;
        return Response.json({ totalItems: 2 }, { status: 202 });
      }
      throw new Error(`Unexpected SDK request ${init?.method} ${url}`);
    }),
  );
  await expect(migrate(env, item, cats)).rejects.toMatchObject({
    retryAfter: 1000,
  });
  const result = await migrate(env, item, cats);
  expect(result.ids).toEqual(["fr-id", "en-id"]);
  expect(assetCount).toBe(2);
  expect(creates[1].alternate_language_id).toBe("fr-id");
  expect(puts[0].data.image.id).toBe(puts[1].data.image.id);
  expect(puts[0].data.site_icon.id).toBe(puts[1].data.site_icon.id);
  expect(puts[0].data.image.dimensions).toEqual({ width: 64, height: 64 });
  expect(puts[0].data.image.alt).toBe(draft.fr.imageAlt);
  expect(puts[1].data.image.alt).toBe(draft.en.imageAlt);
  expect(puts[0].data.credit).toBe("Jane Doe");
  expect(puts[0].data.image.copyright).toBeNull();
  expect(puts[0].data.summary[0].spans).toEqual([]);
  await migrate(env, item, cats);
  expect(assetCount).toBe(2);
  expect(creates).toHaveLength(2);
  expect(puts).toHaveLength(2);
  await publish(env, item);
  await publish(env, item);
  expect(publishCount).toBe(1);
}, 30000);
it("ne considère pas une publication 202 comme une paire vérifiée", async () => {
  const item = fixture();
  item.state.publishedIds = ["fr-id", "en-id"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) =>
      String(input).includes("/documents/search")
        ? Response.json({
            page: 1,
            results_per_page: 20,
            results_size: 0,
            total_results_size: 0,
            total_pages: 1,
            next_page: null,
            prev_page: null,
            results: [],
          })
        : Response.json(repository),
    ),
  );
  expect(await verifyPublication(env, item)).toBe(false);
});

it("ne réessaie pas une authentification Context.dev refusée", async () => {
  const remote = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", remote);
  await expect(
    scrape(env, steps(), "unauthorized", extraction.url),
  ).rejects.toThrow("401");
  expect(remote).toHaveBeenCalledTimes(1);
});
