import type { ReasonCode } from "@/error-reasons";
import { errorFields, log } from "@/observability";
import { BotError, MediaRejected } from "@/domain";
export interface Steps {
  do<T>(
    name: string,
    config: { retries: { limit: number; delay: string }; timeout?: string },
    callback: () => Promise<T>,
  ): Promise<T>;
  sleep(name: string, duration: number): Promise<void>;
}
export class RemoteError extends BotError {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly timeout = false,
    readonly retryAfter = 0,
    readonly requestId?: string,
    code?: ReasonCode,
    httpStatus?: number,
  ) {
    super(
      message,
      code ?? (timeout ? "timeout" : retryAfter ? "rate_limited" : "network"),
      httpStatus,
    );
  }
}
export function retryAfter(headers?: {
  get(name: string): string | null;
}): number {
  const value = headers?.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - Date.now()) || 0;
}
export function classify(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error;
  if (error instanceof BotError)
    return new RemoteError(
      error.message,
      false,
      false,
      0,
      undefined,
      error.reasonCode,
      error.statusCode,
    );
  const e = error as {
    status?: number;
    statusCode?: number;
    name?: string;
    headers?: Headers;
    requestID?: string;
    request_id?: string;
  };
  const status = e?.status ?? e?.statusCode;
  const timeout =
    status === 408 ||
    ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(
      e?.name ?? "",
    );
  return new RemoteError(
    status
      ? `Service distant : HTTP ${status}.`
      : "Connexion au service distant interrompue.",
    timeout || !status || status === 429 || status >= 500,
    timeout,
    retryAfter(e?.headers),
    e?.requestID ?? e?.request_id,
    timeout
      ? "timeout"
      : status === 429
        ? "rate_limited"
        : status && status >= 500
          ? "remote_failed"
          : status
            ? "remote_rejected"
            : "network",
    status,
  );
}
export async function retry<T>(
  step: Steps,
  name: string,
  operation: (attempt: number, afterTimeout: boolean) => Promise<T>,
  random = Math.random,
): Promise<T> {
  let timedOut = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await step.do(
      `${name}-${attempt}`,
      { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
      async () => {
        const started = Date.now();
        try {
          const value = await operation(attempt, timedOut);
          return { ok: true as const, value };
        } catch (e) {
          const error = classify(e);
          const details = {
            ...errorFields(e),
            reasonCode: error.reasonCode,
            httpStatus: errorFields(e).httpStatus ?? error.statusCode,
          };
          log(
            "retry.failed",
            {
              operation: name,
              attempt: attempt + 1,
              ...details,
              durationMs: Date.now() - started,
              providerRequestId:
                errorFields(error).providerRequestId ??
                errorFields(e).providerRequestId,
              timeout: error.timeout,
              retryable: error.retryable,
              exhausted: attempt === 2,
            },
            "warn",
          );
          return {
            ok: false as const,
            message: error.message,
            retryable: error.retryable,
            reasonCode: error.reasonCode,
            httpStatus: details.httpStatus,
            timeout: error.timeout,
            retryAfter: error.retryAfter,
            mediaFilename: e instanceof MediaRejected ? e.filename : undefined,
          };
        }
      },
    );
    if (result.ok) return result.value;
    if (!result.retryable || attempt === 2) {
      log(
        "retry.stopped",
        {
          operation: name,
          attempt: attempt + 1,
          exhausted: attempt === 2,
          reasonCode: result.reasonCode,
          httpStatus: result.httpStatus,
          retryable: result.retryable,
        },
        "error",
      );
      if (result.mediaFilename) throw new MediaRejected(result.mediaFilename);
      throw new BotError(
        result.message,
        result.reasonCode,
        typeof result.httpStatus === "number" ? result.httpStatus : undefined,
      );
    }
    timedOut ||= result.timeout;
    const delayMs = Math.max(
      result.retryAfter,
      [5000, 15000][attempt] * (0.8 + random() * 0.4),
    );
    log("retry.scheduled", { operation: name, attempt: attempt + 2, delayMs });
    await step.sleep(`${name}-backoff-${attempt}`, delayMs);
  }
  throw new Error("Unreachable");
}
