import { AsyncLocalStorage } from "node:async_hooks";
import { tracing } from "cloudflare:workers";
import type { Steps } from "@/retry";

type Value = string | number | boolean | null | undefined | string[];
type Fields = Record<string, Value>;
type Context = {
  itemId?: string;
  workflowId?: string;
  updateId?: number;
  generation?: number;
  traceId?: string;
  spanId?: string;
};
const context = new AsyncLocalStorage<Context>();

// Log only explicitly selected metadata. Never serialize Error, SDK responses,
// request bodies or headers: they may contain prompts, credentials and media.
export function errorFields(error: unknown): Fields {
  const value = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    requestId?: unknown;
    requestID?: unknown;
    request_id?: unknown;
    stack?: unknown;
  } | null;
  return {
    errorType:
      typeof value?.name === "string"
        ? value.name.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)
        : "UnknownError",
    httpStatus:
      typeof value?.status === "number"
        ? value.status
        : typeof value?.statusCode === "number"
          ? value.statusCode
          : undefined,
    providerRequestId: safeId(
      value?.requestId ?? value?.requestID ?? value?.request_id,
    ),
    // Exclude the first line (the potentially sensitive exception message).
    stack:
      typeof value?.stack === "string"
        ? value.stack
            .split("\n")
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 8)
            .map((line) => line.replace(/https?:\/\/\S+/g, "[url]"))
            .join("\n")
        : undefined,
  };
}
function safeId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,150}$/.test(value)
    ? value
    : undefined;
}
export function log(
  event: string,
  fields: Fields = {},
  level: "info" | "warn" | "error" = "info",
) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "curation-bot",
    level,
    event,
    ...context.getStore(),
    ...fields,
  };
  // Passing an object (rather than JSON.stringify) exposes searchable JSON fields
  // directly in Workers Logs and preserves native console severity.
  console[level === "info" ? "log" : level](entry);
}
export function withContext<T>(fields: Context, operation: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, operation);
}
export async function observe<T>(
  operation: string,
  fields: Fields,
  callback: () => Promise<T>,
): Promise<T> {
  const parent = context.getStore();
  const spanId = crypto.randomUUID();
  const traceId = parent?.traceId ?? crypto.randomUUID();
  return withContext({ traceId, spanId }, () =>
    tracing.enterSpan(operation, async (span) => {
      const attributes = { ...context.getStore(), ...fields, operation };
      for (const [key, value] of Object.entries(attributes)) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        )
          span.setAttribute(`curation.${key}`, value);
      }
      const started = Date.now();
      log("operation.start", {
        ...fields,
        operation,
        parentSpanId: parent?.spanId,
      });
      try {
        const result = await callback();
        log("operation.complete", {
          ...fields,
          operation,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        const details = errorFields(error);
        span.recordException({
          name: String(details.errorType),
          message: `Operation failed: ${operation}`,
        });
        log(
          "operation.failed",
          {
            ...fields,
            operation,
            durationMs: Date.now() - started,
            ...details,
          },
          "error",
        );
        throw error;
      }
    }),
  );
}
export function observedSteps(step: Steps): Steps {
  return {
    do: (name, config, callback) =>
      step.do(name, config, () =>
        observe("workflow.step", { step: name }, callback),
      ),
    sleep: (name, duration) => step.sleep(name, duration),
  };
}
