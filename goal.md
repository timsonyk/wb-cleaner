# /goal

SELYUTIN WB Cleaner — SaaS-сервис для селлеров Wildberries, который ежедневно
автоматически анализирует рекламные кампании и минусует неэффективные поисковые
кластеры, экономя рекламный бюджет.

Существующее ядро (Python, ~1750 строк, в продакшене 2 месяца, отработало 240+
прогонов на 3 аккаунтах) делает анализ корректно. Задача — превратить его в
мультитенантный продукт с веб-интерфейсом, чтобы любой селлер мог за 5 минут
подключиться и получить пользу.

## Стек

- Next.js 15 (App Router), TypeScript, React 19
- Drizzle ORM + PostgreSQL 16
- Auth.js v5 (magic link через Resend)
- Tailwind v4 + shadcn/ui
- Python 3.12 воркер (существующий `wb_cluster_optimizer.py`) — оркестратор
  переписать так, чтобы он читал tenants/accounts/rules из Postgres и писал
  туда же runs/decisions, вместо `config.json` и JSON-файлов

## Ключевые инварианты

1. JWT-токены WB шифруются AES-256-GCM, ключ только в env, в БД лежат
   ciphertext + iv + tag. В логи токены не попадают никогда.
2. Каждое решение (keep / exclude) имеет `reason_code` и сохраняется в
   `decisions`. Полный audit-trail — главная защита от споров с клиентом.
3. Новый аккаунт стартует в preview-режиме на 7 дней: воркер копит decisions,
   но НЕ зовёт `set-minus`. После 7 дней пользователь сам включает auto.
4. Pass 3 (`min_clusters_alive = 3`) обязательный — кампания не может быть
   обнулена даже если все кластеры формально под удаление.
5. Rate limits WB (1 req/hour на `/adverts` и `/normquery/stats` per seller)
   соблюдаются батчингом по 50 и `x-ratelimit-retry` хедерами — это уже
   реализовано в Python, не трогать.
6. Воркер идемпотентен: при перезапуске не должен повторно минусовать то, что
   уже есть в `minus_cache`.
7. Любое исключение можно откатить из UI: POST в WB API на восстановление
   фразы, отметить `decision.reverted_at`.

## Не входит в MVP

- Биллинг и подписка
- Команды / агентства (мультипользовательский tenant)
- Биддер ставок (только минусация кластеров)
- Поддержка кампаний с CPC (только CPM)
- Биржа правил, шаблоны от сообщества

## Пользовательские пути

- Регистрация → подключение WB-аккаунта (JWT) → автопроверка валидности
  токена и подгрузка списка кампаний → выбор пресета правил (Одежда /
  Электроника / FMCG / Кастом) → старт preview-режима.
- На дашборде: статус последнего прогона, кол-во минусаций, экономия в
  кликах/показах за период, ссылка на полный лог решений.
- В аудите: фильтр по кампании / nm_id / действию / дате, по каждому
  решению — все метрики и reason_code, кнопка «Восстановить».
- В настройках: профиль правил (форк пресета или ручной тюнинг ползунками),
  канал уведомлений (ntfy URL или email), переключатель preview ↔ auto.

## Схема БД (Drizzle)

| Таблица | Назначение |
|---|---|
| `users` | id, email, name, created_at, last_login_at |
| `sessions` | стандарт NextAuth/Auth.js |
| `wb_accounts` | id, user_id, name, encrypted_token, token_iv, token_tag, token_valid_until, last_validated_at, validation_error, mode (preview\|auto), preview_until, is_active, created_at |
| `rules_profiles` | id, user_id (NULL для пресетов), name, is_preset, min_views, min_ctr, weak_campaign_ctr, min_carts_to_protect, top_keep_pct, min_clusters_alive, banned_keywords (jsonb), use_dynamic_ctr, min_dynamic_ctr |
| `wb_account_rules` | wb_account_id ←→ rules_profile_id (1:1 пока) |
| `runs` | id, wb_account_id, started_at, finished_at, status, mode, summary (jsonb), error_text |
| `campaign_snapshots` | id, run_id, advert_id, name, status, median_ctr, is_weak, daily_stats (jsonb) |
| `decisions` | id, run_id, advert_id, nm_id, norm_query, action, reason_code, ctr, views, clicks, carts, orders, was_applied, applied_at, reverted_at |
| `minus_cache` | wb_account_id, advert_id, nm_id, phrase, applied_at (composite PK) |
| `notifications` | id, user_id, channel (ntfy\|email), target, payload (jsonb), status, sent_at |

Индексы критичны на `decisions(run_id)`, `decisions(advert_id, nm_id)`,
`minus_cache(wb_account_id, advert_id, nm_id)`.

## Структура репо

```
wb-cleaner/
├── apps/
│   ├── web/                 — Next.js 15 App Router
│   │   ├── app/
│   │   │   ├── (auth)/      — login, signup
│   │   │   ├── (app)/       — авторизованная зона
│   │   │   │   ├── dashboard/
│   │   │   │   ├── accounts/
│   │   │   │   ├── decisions/
│   │   │   │   ├── profiles/
│   │   │   │   └── settings/
│   │   │   └── api/
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── db/          — Drizzle schema + client
│   │   │   ├── crypto/      — AES-GCM token encryption
│   │   │   ├── auth/
│   │   │   └── wb-api/      — клиент для un-minus rollback
│   │   └── drizzle/
│   └── worker/              — существующий Python, минимально адаптированный
│       ├── wb_cluster_optimizer.py
│       ├── multi_account_cleaner.py  (теперь читает из БД)
│       ├── db.py            — psycopg, чтение задач / запись решений
│       └── notifications.py
├── packages/
│   └── shared-types/        — JSON-схемы для summary/daily_stats, общие enum'ы
├── docker-compose.yml       — postgres локально
└── README.md
```
