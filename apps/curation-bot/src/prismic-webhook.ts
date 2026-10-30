import { timingSafeEqual } from "node:crypto";
import type { Env } from "@/domain";
import { recordPublicationWebhook, reconcilePublications } from "@/publication";
import { dispatchQueue } from "@/dispatch";
import { errorFields, log } from "@/observability";

const dispatchUrl =
  "https://api.github.com/repos/srigaux/sebastien-rigaux-resume/actions/workflows/deploy.yml/dispatches";
const maxBytes = 64_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handlePrismicWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (!env.PRISMIC_WEBHOOK_SECRET) {
    log("prismic.webhook.unconfigured", {}, "error");
    return new Response("Webhook unavailable", { status: 503 });
  }
  if (Number(request.headers.get("content-length")) > maxBytes)
    return new Response("Too large", { status: 413 });
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return new Response("Too large", { status: 413 });
      }
      chunks.push(value);
    }
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!object(payload)) return new Response("Invalid payload", { status: 400 });
  const secret = Buffer.from(
    typeof payload.secret === "string" ? payload.secret : "",
  );
  const expected = Buffer.from(env.PRISMIC_WEBHOOK_SECRET);
  if (secret.length !== expected.length || !timingSafeEqual(secret, expected))
    return new Response("Unauthorized", { status: 401 });
  if (payload.domain !== env.PRISMIC_REPOSITORY)
    return new Response("Invalid repository", { status: 403 });

  const documentsChanged =
    Array.isArray(payload.documents) &&
    payload.documents.some((id) => typeof id === "string" && id.length > 0);
  // Published releases and discarded releases share the same event. For this
  // ambiguous case, reuse the existing content fingerprint check rather than
  // guessing from Prismic's opaque refs and rebuilding unpublished content.
  const deletions = object(payload.releases)
    ? payload.releases.deletion
    : undefined;
  const releaseDeleted = Array.isArray(deletions) && deletions.some(object);
  if (
    payload.type !== "api-update" ||
    typeof payload.masterRef !== "string" ||
    !payload.masterRef ||
    (!documentsChanged && !releaseDeleted)
  ) {
    log("prismic.webhook.ignored");
    return new Response("Ignored");
  }
  // A release's nested IDs are hints, never proof of publication. Reconciliation
  // always reads both locales from the live API before completing the item.
  const documentIds = new Set<string>();
  const collect = (ids: unknown) => {
    if (Array.isArray(ids))
      for (const id of ids)
        if (typeof id === "string" && id) documentIds.add(id);
  };
  collect(payload.documents);
  if (Array.isArray(deletions))
    for (const release of deletions)
      if (object(release)) collect(release.documents);
  try {
    const awakened = await recordPublicationWebhook(
      env,
      payload.masterRef,
      [...documentIds],
      releaseDeleted,
    );
    if (awakened)
      ctx.waitUntil(
        (async () => {
          await reconcilePublications(env);
          await dispatchQueue(env);
        })().catch((error) =>
          log(
            "prismic.webhook.confirmation.failed",
            errorFields(error),
            "error",
          ),
        ),
      );
  } catch (error) {
    log("prismic.webhook.receipt.failed", errorFields(error), "error");
    return new Response("Publication confirmation unavailable", {
      status: 503,
    });
  }
  if (!env.GITHUB_ACTIONS_TOKEN) {
    log("prismic.webhook.unconfigured", {}, "error");
    return new Response("GitHub unavailable", { status: 503 });
  }
  try {
    const response = await fetch(
      documentsChanged
        ? dispatchUrl
        : dispatchUrl.replace("deploy.yml", "check-website-updates.yml"),
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "sebastien-rigaux-curation-bot",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          ref: "master",
          ...(documentsChanged
            ? {
                inputs: {
                  run_title:
                    "🚀 Prismic publication · " + new Date().toISOString(),
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      },
    );
    if (!response.ok) {
      log(
        "prismic.webhook.dispatch.failed",
        { httpStatus: response.status },
        "error",
      );
      return new Response("GitHub unavailable", { status: 503 });
    }
    log("prismic.webhook.dispatched", { httpStatus: response.status });
    return new Response("OK");
  } catch (error) {
    // Provider errors can contain request headers; never serialize them.
    log("prismic.webhook.dispatch.failed", errorFields(error), "error");
    return new Response("GitHub unavailable", { status: 503 });
  }
}
