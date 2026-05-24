import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Прибиваем корень трейсинга к самому монорепо. Без этого Next ловит
  // лишний lockfile в /Users/timofey/ и пытается отслеживать всю домашнюю
  // папку.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

export default nextConfig;
