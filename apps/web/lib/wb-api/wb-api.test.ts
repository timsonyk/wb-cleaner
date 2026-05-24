import { describe, expect, it, vi } from "vitest";
import {
  validateToken,
  listAdverts,
  getMinusPhrases,
  unMinusPhrase,
} from "./index";

function mockFetch(handlers: Record<string, (init?: RequestInit) => Promise<Response>>) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? "GET"} ${u.pathname}`;
    const h = handlers[key];
    if (!h) throw new Error(`no mock handler for ${key}`);
    return h(init);
  }) as unknown as typeof fetch;
}

describe("validateToken", () => {
  it("валидный токен → {valid:true, campaignsCount}", async () => {
    const fetchImpl = mockFetch({
      "GET /adv/v1/promotion/count": async () =>
        new Response(JSON.stringify({ all: 17, adverts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const res = await validateToken("tok", fetchImpl);
    expect(res).toEqual({ valid: true, campaignsCount: 17 });
  });

  it("401 → reason про невалидный токен", async () => {
    const fetchImpl = mockFetch({
      "GET /adv/v1/promotion/count": async () =>
        new Response("", { status: 401 }),
    });
    const res = await validateToken("tok", fetchImpl);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/невалид/i);
  });

  it("429 → reason про rate limit с секундами", async () => {
    const fetchImpl = mockFetch({
      "GET /adv/v1/promotion/count": async () =>
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-retry": "300" },
        }),
    });
    const res = await validateToken("tok", fetchImpl);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("300");
  });

  it("network_error → reason про сеть", async () => {
    const fetchImpl = mockFetch({
      "GET /adv/v1/promotion/count": async () => {
        throw new Error("ENOTFOUND");
      },
    });
    const res = await validateToken("tok", fetchImpl);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/сетев/i);
  });
});

describe("listAdverts", () => {
  it("пустой список id → []", async () => {
    const fetchImpl = mockFetch({});
    const res = await listAdverts("tok", [], fetchImpl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it("батчит по 50, склеивает результаты", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => i + 1);
    const calls: string[] = [];
    const fetchImpl = mockFetch({
      "GET /api/advert/v2/adverts": async (init) => {
        // URL уже распарсен в mockFetch — берём через fetchImpl.calls? Проще:
        // подменим body не нужно, только посчитаем вызовы.
        calls.push((init?.method ?? "GET") + " adv");
        return new Response(
          JSON.stringify({
            adverts: [
              { id: calls.length, settings: { name: `c${calls.length}` }, status: 9, type: 8 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const res = await listAdverts("tok", ids, fetchImpl);
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2); // 50 + 25
    if (res.ok) expect(res.data.length).toBe(2);
  });
});

describe("getMinusPhrases", () => {
  it("вытаскивает queries из первого item", async () => {
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response(
          JSON.stringify({
            items: [{ advertId: 1, nmId: 2, queries: ["a", "b"] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const res = await getMinusPhrases("tok", 1, 2, fetchImpl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.phrases).toEqual(["a", "b"]);
  });

  it("пустой ответ → phrases=[]", async () => {
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const res = await getMinusPhrases("tok", 1, 2, fetchImpl);
    if (res.ok) expect(res.data.phrases).toEqual([]);
  });
});

describe("unMinusPhrase (двухшаговый)", () => {
  it("удаляет фразу: get-minus → set-minus с остатком", async () => {
    let setBody: { queries?: string[] } | undefined;
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response(
          JSON.stringify({
            items: [{ queries: ["детская курточка", "розовый", "синий"] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      "POST /adv/v0/normquery/set-minus": async (init) => {
        setBody = JSON.parse(init?.body as string);
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const res = await unMinusPhrase("tok", 100, 200, "розовый", fetchImpl);
    expect(res.ok).toBe(true);
    expect(setBody?.queries).toEqual(["детская курточка", "синий"]);
  });

  it("case-insensitive: РОЗОВЫЙ удаляет розовый", async () => {
    let setBody: { queries?: string[] } | undefined;
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response(
          JSON.stringify({ items: [{ queries: ["розовый", "синий"] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      "POST /adv/v0/normquery/set-minus": async (init) => {
        setBody = JSON.parse(init?.body as string);
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const res = await unMinusPhrase("tok", 1, 2, "РОЗОВЫЙ", fetchImpl);
    expect(res.ok).toBe(true);
    expect(setBody?.queries).toEqual(["синий"]);
  });

  it("фразы нет в списке → НЕ вызывает set-minus", async () => {
    let setCalled = 0;
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response(
          JSON.stringify({ items: [{ queries: ["синий"] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      "POST /adv/v0/normquery/set-minus": async () => {
        setCalled++;
        return new Response("{}", { status: 200 });
      },
    });
    const res = await unMinusPhrase("tok", 1, 2, "розовый", fetchImpl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.removed).toBe(false);
    expect(setCalled).toBe(0);
  });

  it("get-minus вернул 401 → пробрасывает token_invalid", async () => {
    const fetchImpl = mockFetch({
      "POST /adv/v0/normquery/get-minus": async () =>
        new Response("", { status: 401 }),
    });
    const res = await unMinusPhrase("tok", 1, 2, "x", fetchImpl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("token_invalid");
  });
});
