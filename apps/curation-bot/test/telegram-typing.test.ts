import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { withTyping } from "@/telegram-typing";

it("refreshes typing while generating and stops after the response", async () => {
  vi.useFakeTimers();
  const calls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, result: true });
    }),
  );
  let finish!: (value: string) => void;
  const operation = new Promise<string>((resolve) => {
    finish = resolve;
  });
  try {
    const running = withTyping(env, "1", () => operation);
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls).toEqual(Array(3).fill({ chat_id: "1", action: "typing" }));
    finish("done");
    expect(await running).toBe("done");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});
it("stops refreshing on a generation error without changing that error", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ ok: true, result: true }));
  vi.stubGlobal("fetch", fetcher);
  let fail!: (error: Error) => void;
  const operation = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const error = new Error("Generation failed");
  try {
    const running = withTyping(env, "1", () => operation);
    const rejection = expect(running).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fail(error);
    await rejection;
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("does not retry a rate-limited typing action or fail the generation", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () =>
    Response.json({
      ok: false,
      error_code: 429,
      description: "Too Many Requests",
      parameters: { retry_after: 60 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let finish!: (value: string) => void;
  const operation = new Promise<string>((resolve) => {
    finish = resolve;
  });
  try {
    const running = withTyping(env, "1", () => operation);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish("generated");
    expect(await running).toBe("generated");
  } finally {
    vi.useRealTimers();
  }
});
