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
  it("retains Telegram error codes without logging the provider description or payload", () => {
    const fields = errorFields({
      name: "GrammyError",
      error_code: 429,
      description: "private description",
      payload: { text: "secret" },
    });
    expect(fields).toMatchObject({ errorType: "GrammyError", httpStatus: 429 });
    expect(JSON.stringify(fields)).not.toMatch(/private description|secret/);
  });
  it("collects native result metadata even when lifecycle logs are disabled", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const resultFields = vi.fn((available: boolean) => ({ available }));
    try {
      expect(
        await observe("publication.verify", {}, async () => false, {
          lifecycleLogs: false,
          resultFields,
        }),
      ).toBe(false);
      expect(resultFields).toHaveBeenCalledExactlyOnceWith(false);
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });

  it("provides a readable message and consistent operation on every event", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      withContext({ itemId: "u42" }, () => {
        log("retry.scheduled", {
          operation: "extract",
          attempt: 2,
          delayMs: 20000,
        });
        log("workflow.waiting", { status: "review" });
        log("future.event");
      });
      const entries = output.mock.calls.map(([entry]) => entry);
      expect(entries[0]).toMatchObject({
        operation: "extract",
        message:
          "Récupération du contenu de l’article — nouvelle tentative prévue | fiche u42 | tentative 2 | dans 20 s",
      });
      expect(entries[1]).toMatchObject({
        operation: "workflow.waiting",
        message:
          "En attente de votre réponse | fiche u42 | validation de la proposition attendue",
      });
      expect(entries.every((entry) => entry.message && entry.operation)).toBe(
        true,
      );
    } finally {
      output.mockRestore();
    }
  });
  it("keeps quiet cron operations silent but still reports their failures", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await observe("scheduled.dispatch", {}, async () => 42, {
          lifecycleLogs: false,
        }),
      ).toBe(42);
      expect(output).not.toHaveBeenCalled();
      const failure = new Error("private payload");
      await expect(
        observe(
          "scheduled.dispatch",
          {},
          async () => {
            throw failure;
          },
          { lifecycleLogs: false },
        ),
      ).rejects.toBe(failure);
      expect(errors.mock.calls[0][0]).toMatchObject({
        event: "operation.failed",
        operation: "scheduled.dispatch",
      });
      expect(errors.mock.calls[0][0].message).toContain(
        "Prise en charge des liens en attente — échec",
      );
      expect(JSON.stringify(errors.mock.calls)).not.toContain(
        "private payload",
      );
    } finally {
      output.mockRestore();
      errors.mockRestore();
    }
  });
  it("translates durable step IDs without exposing them in messages and hides housekeeping", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = {
      do: async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
      sleep: vi.fn(),
    } as Steps;
    try {
      const observed = observedSteps(step);
      for (const name of [
        "g0-c0-catalog-0",
        "g2-c4-action-42-generate-1",
        "u42/g0-c0/image-0-1",
        "g0-c0-migrate-0",
        "g0-c0-publish-0",
        "g0-c0-save",
      ]) {
        await observed.do(
          name,
          { retries: { limit: 0, delay: "1 second" } },
          async () => true,
        );
      }
      const entries = output.mock.calls.map(([entry]) => entry);
      expect(entries).toHaveLength(10);
      expect(
        entries
          .filter((entry) => entry.event === "operation.start")
          .map((entry) => entry.activity),
      ).toEqual([
        "Lecture des sujets et sources disponibles",
        "Rédaction de la proposition en français et en anglais",
        "Téléchargement de l’image de l’article",
        "Création des brouillons et transfert des médias",
        "Demande de publication des versions française et anglaise",
      ]);
      expect(entries[0].message).toBe(
        "Lecture des sujets et sources disponibles — en cours",
      );
      expect(entries[1].message).toMatch(
        /^Lecture des sujets et sources disponibles — terminé/,
      );
      expect(
        entries.some((entry) =>
          /g0-c0|workflow.step|Operation/.test(entry.message),
        ),
      ).toBe(false);
    } finally {
      output.mockRestore();
    }
  });
  it("does not report success when a retry callback returns a durable failure", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = {
      do: async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
      sleep: vi.fn(async () => {}),
    } as Steps;
    try {
      await retry(observedSteps(step), "g0-c0-generate", async (attempt) => {
        if (!attempt)
          throw Object.assign(new Error("private provider response"), {
            statusCode: 429,
          });
        return "draft";
      });
      const completed = output.mock.calls
        .map(([entry]) => entry)
        .filter((entry) => entry.event === "operation.complete");
      expect(completed).toHaveLength(1);
      expect(completed[0].step).toBe("g0-c0-generate-1");
    } finally {
      output.mockRestore();
    }
  });
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
