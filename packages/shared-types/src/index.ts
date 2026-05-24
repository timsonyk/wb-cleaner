// Общие типы для web (TS) и worker (Python — через JSON-schema/литералы).
// Держим строки enum'ов синхронно с pgEnum в apps/web/lib/db/schema.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Константы, которые должны совпадать между web (TS) и worker (Python).
// Python-сторона дублирует значение в apps/worker/wb_cleaner_core/__init__.py.
// ─────────────────────────────────────────────────────────────────────────────

/** Имя пресета, который привязывается к новому WB-аккаунту по умолчанию. */
export const DEFAULT_PRESET_NAME = "Одежда";

// ─────────────────────────────────────────────────────────────────────────────
// Enums (зеркалят pgEnum в schema.ts — менять синхронно)
// ─────────────────────────────────────────────────────────────────────────────

export const REASON_CODES = [
  "low_ctr_no_carts",
  "banned_keyword",
  "insufficient_data",
  "protected_by_cart",
  "protected_by_order",
  "protected_top_weak",
  "protected_min_alive",
  "above_threshold",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DECISION_ACTIONS = ["keep", "exclude"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "partial",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ["preview", "auto", "manual"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const ACCOUNT_MODES = ["preview", "auto"] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// JSONB payloads
// ─────────────────────────────────────────────────────────────────────────────

/** runs.summary — агрегат прогона. Заполняет воркер. */
export interface RunSummary {
  campaignsTotal: number;
  campaignsProcessed: number;
  campaignsSkipped: number;
  clustersTotal: number;
  clustersExcluded: number;
  clustersKept: number;
  weakCampaigns: number;
  renamedCampaigns: number;
  totalViews: number;
  totalClicks: number;
  excludedViews: number;
  fromCache: number;
  totalMinus: number;
  processingTimeSec: number;
  errors: string[];
}

/** campaign_snapshots.daily_stats — сырые dailyStats от WB normquery API. */
export interface DailyStatRow {
  date: string; // YYYY-MM-DD
  stat: {
    normQuery?: string;
    views?: number;
    clicks?: number;
    atbs?: number;
    orders?: number;
    spend?: number;
  };
}
export type DailyStats = DailyStatRow[];

/** notifications.payload — гибкий формат, валидируется воркером перед отправкой. */
export type NotificationPayload =
  | { kind: "run_summary"; runId: string; lines: string[] }
  | { kind: "cooldown"; lines: string[] }
  | { kind: "raw"; title: string; body: string };
