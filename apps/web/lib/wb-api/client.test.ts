import { describe, expect, it, vi } from "vitest";
import { wbRequest, maskToken, formatErrorForLog } from "./client";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn().mockImplementation(impl) as unknown as typeof fetch;
}

describe("wbRequest", () => {
  it("возвращает ok=true с json при 200", async () => {
    const fetchImpl = mockFetch(async () =>
      new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await wbRequest<{ ok: number }>({
      method: "GET",
      path: "/adv/v1/promotion/count",
      token: "tok-xyz",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.ok).toBe(1);
  });

  it("401 → token_invalid", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 401 }));
    const res = await wbRequest({
      method: "GET",
      path: "/adv/v1/promotion/count",
      token: "tok-xyz",
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("token_invalid");
      if (res.error.kind === "token_invalid") expect(res.error.status).toBe(401);
    }
  });

  it("403 → token_invalid", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 403 }));
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "token_invalid") {
      expect(res.error.status).toBe(403);
    }
  });

  it("429 с x-ratelimit-retry → rate_limited с retryAfterSec", async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-retry": "120" },
        }),
    );
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "rate_limited") {
      expect(res.error.retryAfterSec).toBe(120);
    }
  });

  it("429 с Retry-After (fallback) → rate_limited", async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response("", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
    );
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    if (!res.ok && res.error.kind === "rate_limited") {
      expect(res.error.retryAfterSec).toBe(30);
    } else {
      throw new Error("expected rate_limited");
    }
  });

  it("таймаут возвращает {timeout}", async () => {
    // Fetch, который никогда не отвечает, пока его не отменят через AbortController.
    const fetchImpl = mockFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      timeoutMs: 20,
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
  });

  it("сетевая ошибка (не abort) → network_error", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    if (!res.ok) {
      expect(res.error.kind).toBe("network_error");
    } else {
      throw new Error("expected error");
    }
  });

  it("500 → bad_response со статусом", async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response("server boom", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    const res = await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    if (!res.ok && res.error.kind === "bad_response") {
      expect(res.error.status).toBe(500);
      expect(res.error.message).toContain("server boom");
    } else {
      throw new Error("expected bad_response");
    }
  });

  it("прокидывает токен в Authorization", async () => {
    const captured: { authorization?: string } = {};
    const fetchImpl = mockFetch(async (_url, init) => {
      const h = new Headers(init?.headers);
      captured.authorization = h.get("authorization") ?? undefined;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await wbRequest({
      method: "GET",
      path: "/x",
      token: "tok-xyz",
      fetchImpl,
    });
    expect(captured.authorization).toBe("tok-xyz");
  });

  it("сериализует body в JSON для POST", async () => {
    const captured: { body?: string; contentType?: string | null } = {};
    const fetchImpl = mockFetch(async (_url, init) => {
      captured.body = init?.body as string;
      const h = new Headers(init?.headers);
      captured.contentType = h.get("content-type");
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await wbRequest({
      method: "POST",
      path: "/x",
      token: "tok-xyz",
      body: { a: 1 },
      fetchImpl,
    });
    expect(captured.body).toBe('{"a":1}');
    expect(captured.contentType).toBe("application/json");
  });
});

describe("maskToken", () => {
  it("показывает только последние 4", () => {
    expect(maskToken("abcdefghijklmnop")).toBe("***mnop");
  });
  it("для короткой строки → ***", () => {
    expect(maskToken("short")).toBe("***");
  });
  it("для пустой → <empty>", () => {
    expect(maskToken("")).toBe("<empty>");
  });
});

describe("formatErrorForLog", () => {
  it("включает kind и маскированный токен, но не полный токен", () => {
    const log = formatErrorForLog(
      { kind: "token_invalid", status: 401, message: "rejected" },
      { method: "GET", path: "/x", token: "verylongtokenvalue1234" },
    );
    expect(log).toContain("token_invalid");
    expect(log).toContain("***1234");
    expect(log).not.toContain("verylongtokenvalue1234");
  });
});
