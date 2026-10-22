import { log } from "@/observability";
import ContextDev from "context.dev";
import {
  BotError,
  webUrl,
  type Env,
  type Extraction,
  type Media,
  type MediaSet,
} from "@/domain";
import { RemoteError, retry, retryAfter, type Steps } from "@/retry";

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
function urls(...values: unknown[]): string[] {
  return [
    ...new Set(
      values.flatMap((v) => {
        if (Array.isArray(v)) return urls(...v);
        const s = typeof v === "string" ? v : record(v).url;
        try {
          return typeof s === "string" ? [webUrl(s)] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
export function extractResult(raw: unknown): Extraction {
  const page = record(raw),
    md = record(page.markdown),
    metadata = record(page.metadata);
  if (md.success !== true || typeof md.data !== "string" || !md.data.trim()) {
    const code = String(md.error_code ?? "EMPTY_MARKDOWN");
    throw new RemoteError(
      `Extraction impossible (${code}).`,
      ["REQUEST_TIMEOUT", "INTERNAL_ERROR", "WEBSITE_ACCESS_ERROR"].includes(
        code,
      ),
      code === "REQUEST_TIMEOUT",
      0,
      typeof page.request_id === "string" ? page.request_id : undefined,
    );
  }
  const text = md.data.trim();
  if (
    text.length < 80 ||
    (text.length < 1200 &&
      /sign in to continue|please (?:log|sign) in|access denied|verify you are human|connectez-vous pour continuer/i.test(
        text,
      ))
  )
    throw new BotError(
      "La page ne contient pas de contenu exploitable ou présente un écran de connexion.",
    );
  if (md.data.length > 220_000)
    throw new BotError(
      "Article trop volumineux pour être transmis intégralement au modèle.",
    );
  function structuredAuthor(value: unknown, depth = 0): unknown {
    if (depth > 5 || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value))
      return value.map((v) => structuredAuthor(v, depth + 1)).find(Boolean);
    const object = record(value);
    return object.author ?? structuredAuthor(object["@graph"], depth + 1);
  }
  const jsonAuthor = structuredAuthor(metadata.jsonLd);
  const authorValues = metadata.author ?? metadata.authors ?? jsonAuthor;
  const author =
    typeof authorValues === "string"
      ? authorValues.trim()
      : Array.isArray(authorValues)
        ? authorValues
            .map((a) => (typeof a === "string" ? a : record(a).name))
            .filter((a) => typeof a === "string")
            .join(", ")
        : record(authorValues).name;
  const openGraph = record(metadata.openGraph),
    twitter = record(metadata.twitter);
  return {
    url: webUrl(String(page.url)),
    markdown: md.data,
    metadata,
    partial: page.isPartial === true,
    requestId:
      typeof page.request_id === "string" ? page.request_id : undefined,
    ...(typeof author === "string" && author
      ? {
          author: {
            name: author,
            evidence:
              metadata.author || metadata.authors
                ? "metadata.author/authors"
                : "metadata.jsonLd.author",
          },
        }
      : {}),
    imageUrls: urls(
      metadata.image,
      openGraph.image,
      openGraph.images,
      twitter.image,
      record(page.images).data,
    ),
    iconUrl: urls(metadata.favicon)[0],
  };
}
export async function scrape(
  env: Env,
  step: Steps,
  name: string,
  url: string,
): Promise<Extraction> {
  return retry(step, name, async (attempt, afterTimeout) => {
    const client = new ContextDev({
      apiKey: env.CONTEXT_DEV_API_KEY,
      maxRetries: 0,
      timeout: afterTimeout ? 210_000 : 120_000,
    });
    const page = await client.web.scrape({
      url: webUrl(url),
      formats: { markdown: true, images: true },
      sharedParams: {
        mainContentOnly: true,
        dismissPopups: true,
        settleAnimations: true,
      },
      timeoutOpts: {
        milliseconds: afterTimeout ? 180_000 : 90_000,
        behavior: "return-partial",
      },
      maxAgeMs: attempt ? 0 : 86_400_000,
    });
    const result = extractResult(page);
    log("extraction.complete", {
      providerRequestId: result.requestId,
      partial: result.partial,
      imageCount: result.imageUrls.length,
      hasIcon: Boolean(result.iconUrl),
      hasAuthor: Boolean(result.author),
    });
    return result;
  });
}
const MAX_MEDIA = 10 * 1024 * 1024;
export async function downloadMedia(
  env: Env,
  step: Steps,
  name: string,
  url: string,
): Promise<Media> {
  const key = `media/${name}`;
  return retry(step, name, async () => {
    let current = webUrl(url);
    let response: Response | undefined;
    for (let redirects = 0; redirects < 6; redirects++) {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location)
        throw new RemoteError("Redirection de média invalide.", false);
      current = webUrl(new URL(location, current).href);
    }
    if (!response?.ok)
      throw new RemoteError(
        `Média inaccessible (HTTP ${response?.status}).`,
        !!response &&
          (response.status === 408 ||
            response.status === 429 ||
            response.status >= 500),
        false,
        retryAfter(response?.headers),
      );
    const mime =
      response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "image/avif",
      ].includes(mime)
    )
      throw new RemoteError(
        "Le fichier extrait n’est pas une image prise en charge.",
        false,
      );
    if (Number(response.headers.get("content-length")) > MAX_MEDIA)
      throw new RemoteError("Média supérieur à 10 Mio.", false);
    const reader = response.body?.getReader();
    if (!reader) throw new RemoteError("Média vide.", false);
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA) {
        await reader.cancel();
        throw new RemoteError("Média supérieur à 10 Mio.", false);
      }
      parts.push(value);
    }
    if (!size) throw new RemoteError("Média vide.", false);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
    const extension =
      (
        {
          "image/svg+xml": "svg",
          "image/jpeg": "jpg",
          "image/x-icon": "ico",
          "image/vnd.microsoft.icon": "ico",
        } as Record<string, string>
      )[mime] ?? mime.split("/")[1];
    return {
      url,
      key,
      mime,
      size,
      filename: `${name.split("/").pop()}.${extension}`,
    };
  });
}
export async function collectMedia(
  env: Env,
  step: Steps,
  prefix: string,
  extraction: Extraction,
  previous?: MediaSet,
): Promise<MediaSet> {
  const result: MediaSet = {
    image: previous?.image,
    icon: previous?.icon,
    failures: [],
  };
  for (const kind of ["image", "icon"] as const) {
    if (result[kind]) continue;
    const candidates =
      kind === "image"
        ? extraction.imageUrls.slice(0, 3)
        : extraction.iconUrl
          ? [extraction.iconUrl]
          : [];
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      const shared =
        result.image?.url === url
          ? result.image
          : result.icon?.url === url
            ? result.icon
            : undefined;
      if (shared) {
        result[kind] = shared;
        break;
      }
      try {
        result[kind] = await downloadMedia(
          env,
          step,
          `${prefix}/${kind}-${i}`,
          url,
        );
        break;
      } catch (e) {
        if (i === candidates.length - 1)
          result.failures.push({
            kind,
            url,
            reason: e instanceof Error ? e.message : "Média inaccessible",
          });
      }
    }
  }
  return result;
}
