import type { WbApiError, WbResult } from "./types";

export const WB_BASE_URL = "https://advert-api.wildberries.ru";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Показываем только последние 4 символа токена. Логи + сообщения об ошибках
 * проходят через эту функцию. ЗАПРЕЩЕНО логировать `jwt` напрямую.
 */
export function maskToken(jwt: string): string {
  if (!jwt) return "<empty>";
  if (jwt.length <= 8) return "***";
  return `***${jwt.slice(-4)}`;
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  token: string;
  body?: unknown;
  query?: Record<string, string | number>;
  timeoutMs?: number;
  // Внедрение для тестов. В проде используется global fetch.
  fetchImpl?: typeof fetch;
}

/**
 * Единая точка вызова WB API. Никогда не throw'ит — возвращает WbResult.
 * Обрабатывает: timeout, 401/403, 429 + x-ratelimit-retry, прочие не-2xx.
 *
 * Логи: путь и статус — да, токен — никогда (через maskToken).
 */
export async function wbRequest<T>(opts: RequestOptions): Promise<WbResult<T>> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = new URL(opts.path, WB_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: opts.method,
      headers: {
        Authorization: opts.token,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort =
      (err instanceof Error && err.name === "AbortError") ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "AbortError");
    if (isAbort) {
      return {
        ok: false,
        error: {
          kind: "timeout",
          message: `WB API timeout after ${timeoutMs}ms: ${opts.method} ${opts.path}`,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "network_error",
        message: `WB API network error: ${opts.method} ${opts.path} (${(err as Error).message ?? "unknown"})`,
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: {
        kind: "token_invalid",
        status: response.status,
        message: `WB API ${response.status}: token rejected (${opts.method} ${opts.path})`,
      },
    };
  }

  if (response.status === 429) {
    const retryHeader =
      response.headers.get("x-ratelimit-retry") ??
      response.headers.get("Retry-After") ??
      "60";
    const retryAfterSec = Number.parseInt(retryHeader, 10);
    return {
      ok: false,
      error: {
        kind: "rate_limited",
        retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : 60,
        message: `WB API 429 rate limited: ${opts.method} ${opts.path}, retry in ${retryHeader}s`,
      },
    };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  if (response.status < 200 || response.status >= 300) {
    let bodyPreview = "";
    try {
      bodyPreview = (await response.text()).slice(0, 300);
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: {
        kind: "bad_response",
        status: response.status,
        message: `WB API ${response.status}: ${opts.method} ${opts.path} — ${bodyPreview}`,
      },
    };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "bad_response",
        status: response.status,
        message: `WB API ${response.status}: response was not valid JSON (${(err as Error).message})`,
      },
    };
  }
}

/** Структурированный лог об ошибке. Никогда не включает токен. */
export function formatErrorForLog(
  err: WbApiError,
  ctx: { method: string; path: string; token: string },
): string {
  return `[wb-api] ${ctx.method} ${ctx.path} token=${maskToken(ctx.token)} → ${err.kind}: ${err.message}`;
}
