import { env, applyD1Migrations } from "cloudflare:test";
import { beforeEach, afterEach, vi } from "vitest";
import type { Env as AppEnv } from "@/domain";
import type { D1Migration } from "@cloudflare/vitest-plugin";
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(
    [
      "publication_checks",
      "actions",
      "messages",
      "items",
      "inbox",
      "operations",
      "publication_lock",
      "cache",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected external request in test");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
