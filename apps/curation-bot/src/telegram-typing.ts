import type { Steps } from "@/retry";
import { Api } from "grammy";
import type { Env } from "@/domain";
import { errorFields, log } from "@/observability";

// Workflow work runs after the webhook has returned, outside grammY middleware.
// Keep this UI-only signal inside the actual generation attempt, never a durable
// sleep or a human wait. Recursive timeouts avoid overlapping Telegram requests.
export async function withTyping<T>(
  env: Env,
  chatId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>;
  const tick = async () => {
    try {
      await api.sendChatAction(
        chatId,
        "typing",
        {},
        // grammY's declaration uses its legacy AbortSignal shim; Workers
        // supplies the equivalent native signal at runtime.
        AbortSignal.any([
          stop.signal,
          AbortSignal.timeout(3000),
        ]) as unknown as Parameters<typeof api.sendChatAction>[3],
      );
      if (!stop.signal.aborted)
        timer = setTimeout(() => {
          pending = tick();
        }, 4000);
    } catch (error) {
      // A typing failure must not fail or repeat the LLM call. Stop refreshing
      // even on 429 rather than retrying in violation of Telegram's cooldown.
      if (!stop.signal.aborted)
        log("telegram.typing.failed", errorFields(error), "warn");
    }
  };
  pending = tick();
  try {
    return await operation();
  } finally {
    stop.abort();
    if (timer !== undefined) clearTimeout(timer);
    await pending;
  }
}

// Only use this adapter for extraction/media steps: each notification loop ends
// with its callback, before any durable retry delay or human wait.
export function typingSteps(env: Env, chatId: string, step: Steps): Steps {
  return {
    do: (name, config, callback) =>
      step.do(name, config, () => withTyping(env, chatId, callback)),
    sleep: (name, duration) => step.sleep(name, duration),
  };
}
