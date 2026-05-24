import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const accountModeEnum = pgEnum("account_mode", ["preview", "auto"]);

export const runModeEnum = pgEnum("run_mode", ["preview", "auto", "manual"]);

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "partial",
]);

export const decisionActionEnum = pgEnum("decision_action", ["keep", "exclude"]);

// Зеркалит `Decision.rule` из существующего Python-ядра + явные коды для
// будущих веток. Любой новый код требует миграции — это намеренно, чтобы
// аудит-лог нельзя было засорить произвольными строками.
export const reasonCodeEnum = pgEnum("reason_code", [
  "low_ctr_no_carts",       // CTR < порога, корзин нет
  "banned_keyword",         // запрещённое слово
  "insufficient_data",      // views < min_views
  "protected_by_cart",      // ≥1 корзина
  "protected_by_order",     // ≥1 заказ
  "protected_top_weak",     // топ-20% в слабой кампании
  "protected_min_alive",    // гарантия min_clusters_alive
  "above_threshold",        // CTR ≥ порога
]);

// MVP — только in-app уведомления в личном кабинете. ntfy/email убрали;
// внешние каналы вернём отдельной итерацией, когда понадобятся.
export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

// ─────────────────────────────────────────────────────────────────────────────
// users / accounts / sessions / verificationTokens — Auth.js v5 + Drizzle adapter
// Колонки (emailVerified, image, accounts, verification_tokens) — то, что
// @auth/drizzle-adapter требует. createdAt/lastLoginAt — наши собственные.
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// Для OAuth-провайдеров. Magic-link сам по себе её не использует, но адаптер
// требует наличия таблицы. Композитный PK (provider, providerAccountId) —
// требование Auth.js, не переименовывать.
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({
      name: "accounts_pk",
      columns: [t.provider, t.providerAccountId],
    }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "verification_tokens_pk",
      columns: [t.identifier, t.token],
    }),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// wb_accounts — подключённый аккаунт Wildberries
// ─────────────────────────────────────────────────────────────────────────────

export const wbAccounts = pgTable(
  "wb_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    // AES-256-GCM: токен никогда не лежит в открытом виде. См. lib/crypto/token.ts.
    encryptedToken: text("encrypted_token").notNull(), // base64
    tokenIv: text("token_iv").notNull(),               // base64 (12 байт)
    tokenTag: text("token_tag").notNull(),             // base64 (16 байт)

    tokenValidUntil: timestamp("token_valid_until", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    validationError: text("validation_error"),

    mode: accountModeEnum("mode").notNull().default("preview"),
    previewUntil: timestamp("preview_until", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("wb_accounts_user_id_idx").on(t.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// rules_profiles — пресет или кастомный профиль
// ─────────────────────────────────────────────────────────────────────────────

export const rulesProfiles = pgTable(
  "rules_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }), // NULL для системных пресетов
    name: text("name").notNull(),
    isPreset: boolean("is_preset").notNull().default(false),

    minViews: integer("min_views").notNull(),
    minCtr: doublePrecision("min_ctr").notNull(),
    weakCampaignCtr: doublePrecision("weak_campaign_ctr").notNull(),
    minCartsToProtect: integer("min_carts_to_protect").notNull().default(1),
    topKeepPct: doublePrecision("top_keep_pct").notNull(),
    minClustersAlive: integer("min_clusters_alive").notNull().default(3),

    bannedKeywords: jsonb("banned_keywords")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    useDynamicCtr: boolean("use_dynamic_ctr").notNull().default(false),
    minDynamicCtr: doublePrecision("min_dynamic_ctr").notNull().default(2.0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rules_profiles_user_id_idx").on(t.userId),
    // Имена пресетов уникальны, чтобы seed был идемпотентным.
    uniqueIndex("rules_profiles_preset_name_uq")
      .on(t.name)
      .where(sql`is_preset = true`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// wb_account_rules — связь аккаунт ↔ профиль (1:1 пока)
// ─────────────────────────────────────────────────────────────────────────────

export const wbAccountRules = pgTable("wb_account_rules", {
  wbAccountId: uuid("wb_account_id")
    .primaryKey()
    .references(() => wbAccounts.id, { onDelete: "cascade" }),
  rulesProfileId: uuid("rules_profile_id")
    .notNull()
    .references(() => rulesProfiles.id, { onDelete: "restrict" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// runs — каждый запуск чистки
// ─────────────────────────────────────────────────────────────────────────────

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wbAccountId: uuid("wb_account_id")
      .notNull()
      .references(() => wbAccounts.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: runStatusEnum("status").notNull().default("pending"),
    mode: runModeEnum("mode").notNull(),
    summary: jsonb("summary"),
    errorText: text("error_text"),
  },
  (t) => [
    index("runs_account_started_idx").on(t.wbAccountId, t.startedAt),
    index("runs_status_idx").on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// campaign_snapshots — снапшот одной кампании в момент прогона
// ─────────────────────────────────────────────────────────────────────────────

export const campaignSnapshots = pgTable(
  "campaign_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    advertId: bigint("advert_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    status: integer("status"),
    medianCtr: doublePrecision("median_ctr"),
    isWeak: boolean("is_weak").notNull().default(false),
    dailyStats: jsonb("daily_stats"),
  },
  (t) => [index("campaign_snapshots_run_id_idx").on(t.runId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// decisions — audit-trail: одно решение на (run, advert, nm, norm_query)
// ─────────────────────────────────────────────────────────────────────────────

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    advertId: bigint("advert_id", { mode: "number" }).notNull(),
    nmId: bigint("nm_id", { mode: "number" }).notNull(),
    normQuery: text("norm_query").notNull(),
    action: decisionActionEnum("action").notNull(),
    reasonCode: reasonCodeEnum("reason_code").notNull(),
    ctr: doublePrecision("ctr"),
    views: integer("views"),
    clicks: integer("clicks"),
    carts: integer("carts"),
    orders: integer("orders"),
    wasApplied: boolean("was_applied").notNull().default(false),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
  },
  (t) => [
    index("decisions_run_id_idx").on(t.runId),
    index("decisions_advert_nm_idx").on(t.advertId, t.nmId),
    index("decisions_action_idx").on(t.action),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// minus_cache — какие фразы уже заминусованы (для идемпотентности)
// Composite PK = (account, advert, nm, phrase) — двойной минус невозможен.
// ─────────────────────────────────────────────────────────────────────────────

export const minusCache = pgTable(
  "minus_cache",
  {
    wbAccountId: uuid("wb_account_id")
      .notNull()
      .references(() => wbAccounts.id, { onDelete: "cascade" }),
    advertId: bigint("advert_id", { mode: "number" }).notNull(),
    nmId: bigint("nm_id", { mode: "number" }).notNull(),
    phrase: text("phrase").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "minus_cache_pk",
      columns: [t.wbAccountId, t.advertId, t.nmId, t.phrase],
    }),
    index("minus_cache_account_advert_nm_idx").on(
      t.wbAccountId,
      t.advertId,
      t.nmId,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// notifications — отправленные уведомления (ntfy/email)
// ─────────────────────────────────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    target: text("target").notNull(), // ntfy topic URL или email
    payload: jsonb("payload"),
    status: notificationStatusEnum("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notifications_user_id_idx").on(t.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Удобные типы для прикладного кода
// ─────────────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;

export type WbAccount = typeof wbAccounts.$inferSelect;
export type NewWbAccount = typeof wbAccounts.$inferInsert;

export type RulesProfile = typeof rulesProfiles.$inferSelect;
export type NewRulesProfile = typeof rulesProfiles.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

export type CampaignSnapshot = typeof campaignSnapshots.$inferSelect;
export type NewCampaignSnapshot = typeof campaignSnapshots.$inferInsert;

export type MinusCacheRow = typeof minusCache.$inferSelect;
export type NewMinusCacheRow = typeof minusCache.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
