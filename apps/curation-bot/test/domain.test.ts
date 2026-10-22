import { describe, expect, it, vi } from "vitest";
import {
  canonicalFor,
  assertDraft,
  editorialSchema,
  dateInBrussels,
  linksIn,
  normalizeUrl,
  webUrl,
} from "@/domain";
import { extractResult } from "@/extract";
import { retry, RemoteError, retryAfter, type Steps } from "@/retry";
import { explicitSource, applyAction } from "@/flow";
import { cats, draft, fixture } from "@test/fixtures";
import { env } from "cloudflare:test";
export function steps() {
  return {
    do: vi.fn(async (_n: string, _c: unknown, fn: () => Promise<unknown>) =>
      fn(),
    ),
    sleep: vi.fn(async () => {}),
  } as unknown as Steps;
}
describe("URL, éditorial et attributions", () => {
  it("normalise le suivi sans supprimer les paramètres fonctionnels ni confondre les chemins", () => {
    expect(
      normalizeUrl("https://example.com/a?utm_source=x&page=2&gclid=y#h"),
    ).toBe("https://example.com/a?page=2");
    expect(normalizeUrl("https://example.com/a")).not.toBe(
      normalizeUrl("https://example.com/a/"),
    );
    expect(() => webUrl("http://127.0.0.1/a")).toThrow();
    expect(() => webUrl("file:///etc/passwd")).toThrow();
  });
  it("calcule la date belge aux frontières UTC et conserve plusieurs liens à désambiguïser", () => {
    expect(dateInBrussels(new Date("2026-10-18T22:30:00Z"))).toBe("2026-10-19");
    expect(
      linksIn("Lien https://example.com/a puis https://example.org/b."),
    ).toHaveLength(2);
  });
  it("valide les catalogues et les limites de paragraphe", () => {
    expect(assertDraft(draft, cats)).toEqual(draft);
    expect(editorialSchema(cats).safeParse(draft).success).toBe(true);
    expect(
      editorialSchema(cats).safeParse({ ...draft, topics: ["invented"] })
        .success,
    ).toBe(false);
    expect(
      editorialSchema(cats).safeParse({
        ...draft,
        sourceSuggestionUid: "invented",
      }).success,
    ).toBe(false);
    expect(() =>
      assertDraft({ ...draft, topics: ["invented"] }, cats),
    ).toThrow();
    expect(() =>
      assertDraft(
        { ...draft, fr: { ...draft.fr, summary: "- Liste incorrecte" } },
        cats,
      ),
    ).toThrow();
    expect(() =>
      assertDraft({ ...draft, publishedOn: "2026-02-30" }, cats),
    ).toThrow();
  });
  it("extrait auteur et deux médias sans attribuer à l’auteur les droits des images", () => {
    const result = extractResult({
      url: "https://example.com/a",
      markdown: {
        success: true,
        data: "By Jane Doe. This article describes how named variants simplify the styling of reusable React button components.",
      },
      metadata: {
        author: "Jane Doe",
        image: "https://example.com/a.png",
        favicon: "https://example.com/i.ico",
      },
      request_id: "req1",
      isPartial: true,
    });
    expect(result.author?.name).toBe("Jane Doe");
    expect(result.imageUrls).toEqual(["https://example.com/a.png"]);
    expect(result.iconUrl).toContain("i.ico");
    expect(result.requestId).toBe("req1");
    expect(result.partial).toBe(true);
    expect(result).not.toHaveProperty("imageCredits");
  });
  it("contrôle les erreurs de sortie même après HTTP 200", () => {
    expect(() =>
      extractResult({ markdown: { success: false, error_code: "NOT_FOUND" } }),
    ).toThrow("NOT_FOUND");
    try {
      extractResult({
        markdown: { success: false, error_code: "REQUEST_TIMEOUT" },
      });
    } catch (e) {
      expect(e).toMatchObject({ retryable: true, timeout: true });
    }
  });
  it("ne déduit une source fournie que depuis une indication explicite", () => {
    expect(explicitSource("Article React", cats)).toBeUndefined();
    expect(explicitSource("source: JavaScript Weekly", cats)).toBe(
      "javascript-weekly",
    );
    expect(explicitSource("source: aucune", cats)).toBeNull();
  });
});
describe("politique durable de réessai", () => {
  it("borne à trois essais, désactive les reprises de step et respecte Retry-After", async () => {
    const step = steps(),
      calls: number[] = [];
    await expect(
      retry(
        step,
        "read",
        async (attempt) => {
          calls.push(attempt);
          throw new RemoteError("rate limited", true, false, 40_000);
        },
        () => 0.5,
      ),
    ).rejects.toThrow();
    expect(calls).toEqual([0, 1, 2]);
    expect(step.sleep).toHaveBeenNthCalledWith(1, "read-backoff-0", 40_000);
    expect(step.sleep).toHaveBeenCalledTimes(2);
    expect(step.do).toHaveBeenCalledWith(
      "read-0",
      expect.objectContaining({ retries: { limit: 0, delay: "1 second" } }),
      expect.any(Function),
    );
  });
  it("ne réessaie pas une erreur permanente et augmente le délai après timeout", async () => {
    const step = steps();
    let calls = 0;
    await expect(
      retry(step, "fatal", async () => {
        calls++;
        throw new RemoteError("404", false);
      }),
    ).rejects.toThrow("404");
    expect(calls).toBe(1);
    const seen: boolean[] = [];
    expect(
      await retry(step, "timeout", async (attempt, timedOut) => {
        seen.push(timedOut);
        if (!attempt) throw new RemoteError("timeout", true, true);
        return "ok";
      }),
    ).toBe("ok");
    expect(seen).toEqual([false, true]);
    expect(retryAfter(new Headers({ "Retry-After": "15" }))).toBe(15000);
  });
});
describe("actions attachées à une proposition", () => {
  it("rejette une ancienne confirmation et exige une source résolue", async () => {
    const item = fixture();
    expect(
      await applyAction(env, steps(), "a", item, cats, {
        kind: "approve",
        revision: 0,
      }),
    ).toContain("plus active");
    expect(item.state.approvedRevision).toBeUndefined();
    item.state.sourceUid = undefined;
    item.status = "source";
    await applyAction(env, steps(), "b", item, cats, {
      kind: "approve",
      revision: 1,
    });
    expect(item.state.approvedRevision).toBeUndefined();
  });
  it("invalide l’accord lors d’une correction et conserve tous les éléments pour le LLM", async () => {
    const item = fixture();
    item.state.approvedRevision = 1;
    await applyAction(env, steps(), "a", item, cats, {
      kind: "revise",
      revision: 1,
      text: "Insiste sur les variantes.",
    });
    expect(item.state.revision).toBe(2);
    expect(item.state.approvedRevision).toBeUndefined();
    expect(item.state.needsRevision).toBe(true);
    expect(item.state.instructions).toEqual(["Insiste sur les variantes."]);
    expect(item.state.draft).toEqual(draft);
  });
  it("confirme explicitement aucune source et ne peut annuler une migration commencée", async () => {
    const item = fixture();
    item.status = "source";
    item.state.sourceUid = undefined;
    await applyAction(env, steps(), "a", item, cats, {
      kind: "source",
      revision: 1,
      value: "none",
    });
    expect(item.state.sourceUid).toBeNull();
    item.state.publicationStarted = true;
    expect(
      await applyAction(env, steps(), "b", item, cats, {
        kind: "cancel",
        revision: 2,
      }),
    ).toContain("réconciliation");
    expect(item.status).not.toBe("cancelled");
  });
});

it("un choix d’image invalide l’accord et conserve la source choisie", async () => {
  const item = fixture();
  item.state.sourceUid = "javascript-weekly";
  item.state.approvedRevision = 1;
  item.state.extractionKey = "extractions/image-choice";
  await env.BUCKET.put(
    item.state.extractionKey,
    JSON.stringify({
      imageUrls: ["https://example.com/one.png", "https://example.com/two.png"],
    }),
  );
  await applyAction(env, steps(), "image-choice", item, cats, {
    kind: "image",
    revision: 1,
    value: "1",
  });
  expect(item.state.imageChoice).toBe("https://example.com/two.png");
  expect(item.state.imagePending).toBe(true);
  expect(item.state.needsRevision).toBe(true);
  expect(item.state.approvedRevision).toBeUndefined();
  expect(item.state.revision).toBe(2);
  expect(item.state.sourceUid).toBe("javascript-weekly");
});

it("une canonique ne supprime pas les paramètres fonctionnels", () => {
  expect(
    canonicalFor(
      "https://example.com/article?lang=fr",
      "https://example.com/article",
    ),
  ).toBe("https://example.com/article?lang=fr");
  expect(
    canonicalFor(
      "https://example.com/article?utm_source=news",
      "https://example.com/article",
    ),
  ).toBe("https://example.com/article");
});
