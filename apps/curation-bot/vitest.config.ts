import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@test": fileURLToPath(new URL("./test", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          TELEGRAM_BOT_TOKEN: "123:test",
          TELEGRAM_WEBHOOK_SECRET: "test-secret",
          TELEGRAM_USER_ID: "1",
          TELEGRAM_CHAT_ID: "1",
          OPENAI_API_KEY: "test",
          CONTEXT_DEV_API_KEY: "test",
          PRISMIC_WRITE_TOKEN: "test",
          PRISMIC_ACCESS_TOKEN: "",
          PUBLISH_ENABLED: "true",
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"], testTimeout: 30_000 },
});
