import { describe, expect, it } from "vitest";
import { isProtected, PROTECTED_PREFIXES } from "./protected-routes";

describe("isProtected", () => {
  it("ловит точное совпадение", () => {
    for (const p of PROTECTED_PREFIXES) {
      expect(isProtected(p)).toBe(true);
    }
  });

  it("ловит вложенный путь", () => {
    expect(isProtected("/dashboard/run/42")).toBe(true);
    expect(isProtected("/decisions/123-uuid")).toBe(true);
  });

  it("публичные маршруты — не защищены", () => {
    expect(isProtected("/")).toBe(false);
    expect(isProtected("/login")).toBe(false);
    expect(isProtected("/verify-request")).toBe(false);
    expect(isProtected("/api/auth/session")).toBe(false);
  });

  it("не путает префикс с другим разделом", () => {
    // /dashboards (с s) не должно матчиться по /dashboard.
    expect(isProtected("/dashboards")).toBe(false);
    expect(isProtected("/settingsx")).toBe(false);
  });
});
