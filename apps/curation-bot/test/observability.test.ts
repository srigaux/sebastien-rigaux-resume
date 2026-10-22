import { describe, expect, it, vi } from "vitest";
import {
  errorFields,
  log,
  observe,
  observedSteps,
  withContext,
} from "@/observability";
import type { Steps } from "@/retry";
import { retry } from "@/retry";

describe("Workers observability", () => {
  it("retains the provider HTTP status and logs the durable retry delay", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const sleep = vi.fn(async () => {});
    const step = {
      do: async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
      sleep,
    } as Steps;
    let calls = 0;
    try {
      const result = await withContext({ itemId: "u42" }, () =>
        retry(
          step,
          "extract",
          async () => {
            if (!calls++)
              throw Object.assign(new Error("private-provider-body"), {
                statusCode: 429,
                requestID: "req_42",
                headers: new Headers({ "retry-after": "20" }),
              });
            return "ok";
          },
          () => 0.5,
        ),
      );
      expect(result).toBe("ok");
      expect(warning.mock.calls[0][0]).toMatchObject({
        event: "retry.failed",
        itemId: "u42",
        httpStatus: 429,
        providerRequestId: "req_42",
        attempt: 1,
        retryable: true,
      });
      expect(output.mock.calls[0][0]).toMatchObject({
        event: "retry.scheduled",
        itemId: "u42",
        attempt: 2,
        delayMs: 20_000,
      });
      expect(sleep).toHaveBeenCalledWith("extract-backoff-0", 20_000);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private-provider-body",
      );
    } finally {
      warning.mockRestore();
      output.mockRestore();
    }
  });
  it("correlates nested operations and isolates concurrent fiches", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await Promise.all(
        ["fiche-a", "fiche-b"].map((itemId) =>
          withContext({ itemId }, () =>
            observe("outer", {}, async () => {
              await Promise.resolve();
              await observe("inner", {}, async () => {
                log("check");
              });
            }),
          ),
        ),
      );
      const entries = output.mock.calls.map(([entry]) => entry);
      for (const itemId of ["fiche-a", "fiche-b"]) {
        const own = entries.filter((entry) => entry.itemId === itemId);
        expect(new Set(own.map((entry) => entry.traceId)).size).toBe(1);
        const outer = own.find(
          (entry) =>
            entry.operation === "outer" && entry.event === "operation.start",
        );
        const inner = own.find(
          (entry) =>
            entry.operation === "inner" && entry.event === "operation.start",
        );
        expect(inner.parentSpanId).toBe(outer.spanId);
        expect(inner.spanId).not.toBe(outer.spanId);
        expect(own.find((entry) => entry.event === "check").spanId).toBe(
          inner.spanId,
        );
      }
      expect(
        entries.find((entry) => entry.itemId === "fiche-a").traceId,
      ).not.toBe(entries.find((entry) => entry.itemId === "fiche-b").traceId);
    } finally {
      output.mockRestore();
    }
  });
  it("logs useful failures without SDK messages, response bodies or secret URLs", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = Object.assign(new Error("secret-token prompt content"), {
      statusCode: 429,
      requestID: "req_123",
      responseBody: "private-article",
    });
    error.stack =
      "Error: secret-token\n    at fetch (https://api.telegram.org/botsecret-token/sendMessage:1:2)\n    at execute (src/editor.ts:10:1)";
    try {
      await expect(
        observe("generate", {}, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      const entry = output.mock.calls[0][0];
      expect(entry.errorType).toBe("Error");
      expect(entry.httpStatus).toBe(429);
      expect(entry.providerRequestId).toBe("req_123");
      expect(entry.event).toBe("operation.failed");
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(entry)).not.toMatch(
        /secret-token|prompt content|private-article/,
      );
      expect(entry.stack).toContain("src/editor.ts:10:1");
      expect(
        errorFields({ requestId: "https://secret.example/token" })
          .providerRequestId,
      ).toBeUndefined();
    } finally {
      output.mockRestore();
      info.mockRestore();
    }
  });
  it("does not rerun callbacks or log execution for cached durable steps", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const callback = vi.fn(async () => "new result");
    const step = {
      do: vi.fn(async () => "cached result"),
      sleep: vi.fn(),
    } as unknown as Steps;
    try {
      expect(
        await observedSteps(step).do(
          "cached",
          { retries: { limit: 0, delay: "1 second" } },
          callback,
        ),
      ).toBe("cached result");
      expect(callback).not.toHaveBeenCalled();
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });
});
