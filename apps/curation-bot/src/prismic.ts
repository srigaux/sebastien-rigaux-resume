import * as prismic from "@prismicio/client";
import {
  AmbiguousWrite,
  BotError,
  MediaRejected,
  normalizeUrl,
  slug,
  type Catalog,
  type Env,
  type Item,
  type Media,
} from "@/domain";
import { RemoteError, retryAfter } from "@/retry";
import { Store } from "@/store";

export function readClient(env: Env) {
  return prismic.createClient(env.PRISMIC_REPOSITORY, {
    accessToken: env.PRISMIC_ACCESS_TOKEN || undefined,
    fetchOptions: { cache: "no-store" },
    fetch: journaledFetch(new Store(env.DB), "read"),
  });
}
export async function catalog(env: Env): Promise<Catalog> {
  const store = new Store(env.DB),
    key = `catalog:${env.PRISMIC_REPOSITORY}`;
  const cached = await store.cache<Catalog>(key);
  if (cached) return cached;
  const client = readClient(env);
  const [topics, sources] = await Promise.all([
    client.getAllByType("topic", { lang: "fr-be" }),
    client.getAllByType("discovery_source", { lang: "fr-be" }),
  ]);
  const map = (doc: prismic.PrismicDocument) => ({
    id: doc.id,
    uid: doc.uid!,
    name: String(doc.data.name ?? doc.uid),
    ...(doc.data.url?.url ? { url: doc.data.url.url as string } : {}),
  });
  const value = { topics: topics.map(map), sources: sources.map(map) };
  if (!value.topics.length || !value.sources.length)
    throw new BotError("Catalogue Prismic vide ou inaccessible.");
  await store.putCache(key, value, 3_600_000);
  return value;
}
export async function publishedDuplicates(
  env: Env,
  url: string,
): Promise<string[]> {
  const docs = await readClient(env).getAllByType("curated_link", {
    lang: "*",
    fetch: ["curated_link.url", "curated_link.title"],
  });
  const found = new Map<string, string>();
  for (const doc of docs) {
    try {
      if (normalizeUrl(doc.data.url.url) !== normalizeUrl(url)) continue;
      const group = [
        doc.id,
        ...doc.alternate_languages.map((d) => d.id),
      ].sort()[0];
      found.set(
        group,
        `${prismic.asText(doc.data.title) || doc.uid} — Prismic ${doc.id}`,
      );
    } catch {
      /* An unrelated empty legacy URL does not match. */
    }
  }
  return [...found.values()];
}
async function digest(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function requestKey(
  url: string,
  init?: { method?: string; body?: unknown },
) {
  let body = "";
  if (init?.body instanceof FormData) {
    const parts = [];
    for (const [key, value] of init.body.entries())
      parts.push([
        key,
        typeof value === "string"
          ? value
          : `${value.name}:${value.type}:${await digest(await value.arrayBuffer())}`,
      ]);
    body = JSON.stringify(parts.sort());
  } else body = String(init?.body ?? "");
  return digest(`${init?.method ?? "GET"}:${url}:${body}`);
}
// An operation result is committed BEFORE the SDK consumes it. A lost/ambiguous
// mutating response is never automatically retried. SDK retries on 429 are
// intercepted here so retries have a durable, finite budget at the workflow level.
export function journaledFetch(
  store: Store,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
  draft?: Item["state"]["draft"],
): prismic.ClientConfig["fetch"] {
  const languages = new Map<string, "fr" | "en">();
  return async (url, init) => {
    if (draft && init?.method === "PUT" && typeof init.body === "string") {
      const body = JSON.parse(init.body);
      const language = languages.get(new URL(url).pathname.split("/").pop()!);
      if (!language)
        throw new BotError(
          "Locale du document non identifiée avant son écriture.",
        );
      if (body.data?.image) body.data.image.alt = draft[language].imageAlt;
      if (body.data?.site_icon)
        body.data.site_icon.alt =
          language === "fr" ? "Icône du site" : "Site icon";
      init = { ...init, body: JSON.stringify(body) };
    }
    const write = !!init?.body;
    if (!write) {
      const res = await fetchImpl(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      });
      if (res.status === 429)
        throw new RemoteError(
          "Prismic limite les lectures.",
          true,
          false,
          retryAfter(res.headers),
        );
      return res;
    }
    const key = `${itemId}:${await requestKey(url, init)}`;
    const old = await store.operation(key);
    const replay = (raw: string) => {
      const saved = JSON.parse(raw) as {
        body: string;
        status: number;
        headers: Record<string, string>;
      };
      return new Response(saved.body, {
        status: saved.status,
        headers: saved.headers,
      });
    };
    const checkedResponse = async (response: Response) => {
      if (
        url.endsWith("/documents") &&
        init?.method === "POST" &&
        response.status === 201 &&
        typeof init.body === "string"
      ) {
        const created = (await response.clone().json()) as { id: string };
        languages.set(
          created.id,
          JSON.parse(init.body).lang === "en-us" ? "en" : "fr",
        );
      }
      if (url.includes("asset") && init?.body instanceof FormData) {
        const file = init.body.get("file");
        if (response.ok) {
          const asset = (await response.clone().json()) as {
            width?: number;
            height?: number;
          };
          if (!asset.width || !asset.height)
            throw new MediaRejected(
              file instanceof File ? file.name : "inconnu",
            );
        }
        if ([400, 413, 415, 422].includes(response.status))
          throw new MediaRejected(file instanceof File ? file.name : "inconnu");
      }
      if (!response.ok)
        throw new BotError(
          `Prismic a refusé l’opération (HTTP ${response.status}). Vérifiez ses droits et les données de la fiche avant reprise.`,
        );
      return response;
    };
    if (old?.status === "done" && old.response)
      return checkedResponse(replay(old.response));
    if (old?.status === "pending") throw new AmbiguousWrite(key);
    if (!old) {
      const inserted = await store.begin(
        key,
        itemId,
        `${init?.method ?? "POST"} ${url}`,
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : {
              filename:
                init?.body instanceof FormData
                  ? (init.body.get("file") as File)?.name
                  : undefined,
            },
      );
      if (!inserted.meta.changes) throw new AmbiguousWrite(key);
    } else {
      const claimed = await store.db
        .prepare(
          "UPDATE operations SET status='pending' WHERE key=? AND status='retryable'",
        )
        .bind(key)
        .run();
      if (!claimed.meta.changes) throw new AmbiguousWrite(key);
    }
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AmbiguousWrite(key);
    }
    const text = await res.text();
    if (res.status === 429) {
      await store.completed(key, { status: 429 }, "retryable");
      throw new RemoteError(
        "Prismic limite les écritures.",
        true,
        false,
        retryAfter(res.headers),
      );
    }
    if (res.status >= 500 || res.status === 408) throw new AmbiguousWrite(key);
    const saved = {
      body: text,
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    };
    await store.completed(key, saved);
    return checkedResponse(replay(JSON.stringify(saved)));
  };
}
export function buildMigration(
  item: Item,
  cats: Catalog,
  files: { image?: File; icon?: File },
) {
  const draft = item.state.draft!;
  const migration = prismic.createMigration();
  const assets = new Map<string, ReturnType<typeof migration.createAsset>>();
  const register = (kind: "image" | "icon", file: File | undefined) => {
    const media = item.state.media?.[kind];
    if (!media || !file) return undefined;
    let ref = assets.get(media.key);
    if (!ref) {
      ref = migration.createAsset(file, media.filename, {
        notes: `Curation ${item.id}; source: ${media.url}`,
      });
      assets.set(media.key, ref);
    }
    return ref;
  };
  const image = register("image", files.image),
    icon = register("icon", files.icon);
  const relation = (id: string) => ({ link_type: "Document" as const, id });
  const common = {
    url: { link_type: "Web" as const, url: item.state.url },
    selected_on: item.state.selectedOn,
    format: draft.format,
    topics: draft.topics.map((uid) => ({
      topic: relation(
        item.state.references?.topics[uid] ??
          cats.topics.find((t) => t.uid === uid)!.id,
      ),
    })),
    ...(draft.sourceLanguage ? { source_language: draft.sourceLanguage } : {}),
    ...(draft.publishedOn ? { published_on: draft.publishedOn } : {}),
    ...(draft.credit ? { credit: draft.credit } : {}),
    ...(item.state.sourceUid
      ? {
          discovered_via: relation(
            item.state.references?.sourceId ??
              cats.sources.find((s) => s.uid === item.state.sourceUid)!.id,
          ),
        }
      : {}),
    ...(image ? { image } : {}),
    ...(icon ? { site_icon: icon } : {}),
  };
  const doc = (lang: "fr" | "en") => ({
    type: "curated_link",
    lang: lang === "fr" ? "fr-be" : "en-us",
    uid: slug(draft[lang].title, lang),
    data: {
      ...common,
      title: [
        { type: "heading1" as const, text: draft[lang].title, spans: [] },
      ],
      summary: [
        { type: "paragraph" as const, text: draft[lang].summary, spans: [] },
      ],
    },
  });
  const french = migration.createDocument(doc("fr"), draft.fr.title);
  const english = migration.createDocument(doc("en"), draft.en.title, {
    masterLanguageDocument: french,
  });
  return { migration, french, english, image, icon };
}
async function mediaFile(env: Env, media?: Media) {
  if (!media) return undefined;
  const obj = await env.BUCKET.get(media.key);
  if (!obj) throw new BotError("Fichier média manquant dans R2.");
  return new File([await obj.arrayBuffer()], media.filename, {
    type: media.mime,
  });
}
export async function migrate(env: Env, item: Item, cats: Catalog) {
  const store = new Store(env.DB);
  const client = prismic.createWriteClient(env.PRISMIC_REPOSITORY, {
    writeToken: env.PRISMIC_WRITE_TOKEN,
    accessToken: env.PRISMIC_ACCESS_TOKEN || undefined,
    fetch: journaledFetch(store, item.id, fetch, item.state.draft),
  });
  const files = {
    image: await mediaFile(env, item.state.media?.image),
    icon: await mediaFile(env, item.state.media?.icon),
  };
  const { migration, french, english, image, icon } = buildMigration(
    item,
    cats,
    files,
  );
  await client.migrate(migration);
  const ids = [french.document.id!, english.document.id!];
  if (ids.some((id) => !id)) throw new BotError("Migration incomplète.");
  return { ids, mediaIds: { image: image?.asset?.id, icon: icon?.asset?.id } };
}
export async function publish(env: Env, item: Item) {
  if (env.PUBLISH_ENABLED !== "true")
    throw new BotError(
      "Publication désactivée : terminer la procédure d’activation de la release de migration réservée au bot.",
    );
  const client = prismic.createWriteClient(env.PRISMIC_REPOSITORY, {
    writeToken: env.PRISMIC_WRITE_TOKEN,
    fetch: journaledFetch(new Store(env.DB), item.id),
  });
  const result = await client.publishMigrationRelease();
  if (result.totalItems !== 2)
    throw new BotError(
      `Prismic a mis ${result.totalItems} documents en publication au lieu de 2. Vérification opérateur nécessaire.`,
    );
}
export async function verifyPublication(
  env: Env,
  item: Item,
): Promise<boolean> {
  if (!item.state.publishedIds?.length) return false;
  const client = readClient(env);
  const docs = await Promise.all(
    item.state.publishedIds.map((id) =>
      client.getByID(id, { lang: "*" }).catch(() => null),
    ),
  );
  return docs.every((doc, i) => {
    if (!doc) return false;
    const lang = i === 0 ? "fr" : "en",
      draft = item.state.draft![lang];
    const other = item.state.publishedIds![i === 0 ? 1 : 0];
    const media = item.state.media;
    return (
      doc.lang === (i === 0 ? "fr-be" : "en-us") &&
      doc.alternate_languages.some((t) => t.id === other) &&
      prismic.asText(doc.data.title) === draft.title &&
      prismic.asText(doc.data.summary) === draft.summary &&
      doc.data.url?.url === item.state.url &&
      doc.data.selected_on === item.state.selectedOn &&
      (doc.data.credit || null) === (item.state.draft!.credit || null) &&
      (doc.data.source_language || null) ===
        (item.state.draft!.sourceLanguage || null) &&
      (doc.data.published_on || null) ===
        (item.state.draft!.publishedOn || null) &&
      doc.data.format === item.state.draft!.format &&
      JSON.stringify(
        (doc.data.topics ?? [])
          .map((t: { topic: { id: string } }) => t.topic.id)
          .sort(),
      ) ===
        JSON.stringify(
          item.state
            .draft!.topics.map((uid) => item.state.references?.topics[uid])
            .sort(),
        ) &&
      (doc.data.discovered_via?.id || null) ===
        (item.state.references?.sourceId || null) &&
      (!media?.image ||
        (doc.data.image?.id === item.state.mediaIds?.image &&
          doc.data.image.alt === draft.imageAlt &&
          doc.data.image.dimensions?.width > 0 &&
          doc.data.image.dimensions?.height > 0)) &&
      (!media?.icon ||
        (doc.data.site_icon?.id === item.state.mediaIds?.icon &&
          doc.data.site_icon.dimensions?.width > 0 &&
          doc.data.site_icon.dimensions?.height > 0))
    );
  });
}
