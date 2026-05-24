// Список защищённых префиксов URL. Держим явный allowlist, а не regex —
// чтобы новый раздел не оказался публичным по ошибке.
// При добавлении новой страницы под /(app) — добавь её префикс сюда.
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/accounts",
  "/decisions",
  "/profiles",
  "/settings",
] as const;

export function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
