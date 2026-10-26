import * as prismic from "@prismicio/client";

// Read-only comparison of the old full-document reads and the current light read.
// Run from apps/curation-bot with node --env-file=.dev.vars scripts/benchmark-publication.mjs FR_ID EN_ID.
const [fr, en] = process.argv.slice(2);
if (![fr, en].every((id) => /^[A-Za-z0-9_-]{10,64}$/.test(id ?? ""))) {
  throw new Error("Pass the IDs of an existing published FR/EN pair.");
}
async function measure(mode) {
  let requests = 0,
    bytes = 0;
  const start = performance.now();
  const client = prismic.createClient(
    process.env.PRISMIC_REPOSITORY || "bd7d5fa0",
    {
      accessToken: process.env.PRISMIC_ACCESS_TOKEN || undefined,
      fetchOptions: { cache: "no-store" },
      fetch: async (url, init) => {
        if (init?.method && init.method !== "GET")
          throw new Error("Only reads are allowed in this benchmark.");
        requests++;
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(30_000),
        });
        bytes += (await response.clone().arrayBuffer()).byteLength;
        return response;
      },
    },
  );
  const documents =
    mode === "full"
      ? await Promise.all(
          [fr, en].map((id) => client.getByID(id, { lang: "*" })),
        )
      : (
          await client.getByIDs([fr, en], {
            lang: "*",
            pageSize: 2,
            fetch: ["curated_link.url"],
          })
        ).results;
  if (
    ![fr, en].every((id, i) =>
      documents.some(
        (doc) => doc.id === id && doc.lang === (i === 0 ? "fr-be" : "en-us"),
      ),
    )
  ) {
    throw new Error("The complete published FR/EN pair is required.");
  }
  return {
    mode,
    ms: Math.round((performance.now() - start) * 10) / 10,
    requests,
    decodedResponseBytes: bytes,
  };
}
try {
  // Warm both paths, then alternate their order to reduce connection/CDN bias.
  await measure("full");
  await measure("light");
  const samples = [];
  for (let round = 0; round < 5; round++) {
    for (const mode of round % 2 ? ["light", "full"] : ["full", "light"]) {
      samples.push({ round: round + 1, ...(await measure(mode)) });
    }
  }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    ["full", "light"].map((mode) => {
      const group = samples.filter((sample) => sample.mode === mode);
      return [
        mode,
        {
          medianMs: median(group.map((sample) => sample.ms)),
          medianRequests: median(group.map((sample) => sample.requests)),
          medianDecodedResponseBytes: median(
            group.map((sample) => sample.decodedResponseBytes),
          ),
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        location: "local Node.js, not Workers",
        rounds: 5,
        summary,
        samples,
      },
      null,
      2,
    ),
  );
} catch {
  // SDK errors may include URLs with access tokens. Do not print them.
  console.error(
    "Benchmark failed: unavailable pair, API error or timeout. No content was written.",
  );
  process.exitCode = 1;
}
