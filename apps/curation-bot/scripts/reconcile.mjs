import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [command, key, responseFile] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
const remote = process.argv.includes("--remote");
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const output = execFileSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      remote ? "--remote" : "--local",
      "--json",
      "--command",
      query,
    ],
    {
      encoding: "utf8",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(output);
}
if (command === "inspect" && key) {
  console.log(
    JSON.stringify(
      sql(
        `SELECT key,item_id,target,request,status,response FROM operations WHERE item_id=${quote(key)}`,
      ),
      null,
      2,
    ),
  );
} else if (
  ["confirm-success", "confirm-not-applied"].includes(command) &&
  key
) {
  if (!process.argv.includes("--reviewed-in-prismic"))
    throw new Error(
      "Inspect the actual operation in Prismic, then pass --reviewed-in-prismic.",
    );
  const rows =
    sql(
      `SELECT o.*,i.status AS item_status FROM operations o JOIN items i ON i.id=o.item_id WHERE o.key=${quote(key)}`,
    )[0]?.results ?? [];
  const row = rows[0];
  // A retry after a lost creation response can reveal that Prismic already
  // created the translation. Only an explicitly reviewed success may reconcile
  // that conflict; it must never be marked safe to retry again.
  let existingTranslation = false;
  try {
    const saved = JSON.parse(row?.response ?? "null");
    existingTranslation =
      command === "confirm-success" &&
      row?.status === "done" &&
      row.target === "POST https://migration.prismic.io/documents" &&
      saved?.status === 400 &&
      JSON.parse(saved.body).message ===
        "There is already an existing translation in this language for the document referenced in 'alternate_language_id'";
  } catch {
    /* Other responses cannot prove an existing translation. */
  }
  if (
    !row ||
    (row.status !== "pending" && !existingTranslation) ||
    row.item_status !== "error"
  )
    throw new Error(
      "Expected a pending operation whose item is stopped in error.",
    );
  let response = null,
    status = "retryable";
  if (command === "confirm-success") {
    if (!responseFile)
      throw new Error(
        "Pass a JSON file containing the exact successful Prismic response.",
      );
    const body = JSON.parse(readFileSync(responseFile, "utf8"));
    const publishing = row.target.includes("migration-release/publish");
    const asset = row.target.includes("asset-api.prismic.io");
    const creating = row.target.startsWith("POST") && !publishing && !asset;
    if (publishing && body.totalItems !== 2)
      throw new Error("Publication must concern exactly two documents.");
    if (creating && typeof body.id !== "string")
      throw new Error("The actual document ID is required.");
    if (
      asset &&
      (!body.id || !body.url || !(body.width > 0) || !(body.height > 0))
    )
      throw new Error(
        "The actual asset ID, CDN URL and dimensions are required.",
      );
    response = {
      status: publishing ? 202 : creating ? 201 : 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
    status = "done";
  }
  const result = sql(
    `UPDATE operations SET status=${quote(status)},response=${response ? quote(JSON.stringify(response)) : "NULL"},updated_at=${quote(new Date().toISOString())} WHERE key=${quote(key)} AND status=${quote(row.status)} AND response IS ${row.response ? quote(row.response) : "NULL"}`,
  );
  if (result[0]?.meta?.changes !== 1)
    throw new Error(
      "Operation changed during reconciliation. Inspect it again.",
    );
  console.log("Operation reconciled. Use /reprendre in Telegram.");
} else
  throw new Error(
    "Usage: reconcile.mjs inspect ITEM | confirm-success KEY response.json | confirm-not-applied KEY [--remote] [--reviewed-in-prismic]",
  );
