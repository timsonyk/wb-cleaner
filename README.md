# wb-cleaner

SELYUTIN WB Cleaner — SaaS для селлеров Wildberries. Полный замысел в
[`goal.md`](./goal.md). Это итерация **0 (фундамент)**: монорепо, БД, шифрование
токенов. Без UI, без Auth.js, без переноса Python — это следующие шаги.

## Стек

- **apps/web** — Next.js 15 + TS + Tailwind v4 + Drizzle ORM
- **apps/worker** — placeholder под Python 3.12 (будущая итерация)
- **packages/shared-types** — TS-типы для `summary`, `daily_stats`, enum'ы
- **PostgreSQL 16** через docker-compose

## Локальный запуск

### Требования
- Node 20+
- pnpm 11+
- Docker

### 1. Установка зависимостей
```bash
pnpm install
```

### 2. ENV
```bash
cp .env.example .env
# Сгенерировать секреты (32 байта в base64 каждый):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # AUTH_SECRET
```

Получить **Resend API key**: [resend.com/api-keys](https://resend.com/api-keys).
Бесплатный тир покрывает разработку.

#### Что хранят переменные

| Переменная | Назначение |
|---|---|
| `POSTGRES_DB / USER / PASSWORD / PORT` | креды для docker-compose. |
| `DATABASE_URL` | URL для приложения и миграций. Должен соответствовать кредам выше. |
| `TOKEN_ENCRYPTION_KEY` | **критично.** 32 случайных байта в base64. AES-256-GCM шифрование WB-токенов. При потере — токены становятся нерасшифровываемыми. |
| `AUTH_SECRET` | **критично.** Подпись session-cookie / CSRF в Auth.js. Без него Auth.js падает на старте. |
| `AUTH_URL` | Публичный URL приложения. Локально — `http://localhost:3000`. В проде поменять на свой домен. |
| `AUTH_RESEND_KEY` | API-ключ Resend для отправки magic link. |
| `EMAIL_FROM` | От кого приходит письмо. Дефолт — `WB Cleaner <onboarding@resend.dev>` (Resend разрешает этот sender для тестов). В проде — `noreply@yourdomain.com` после верификации домена. |

> **Resend в dev-режиме разрешает отправку только на email владельца аккаунта**
> (пока домен не верифицирован). Если письмо не приходит — проверь, что вход
> на /login делается с того же адреса, на котором зарегистрирован Resend.

### 3. Поднять Postgres
```bash
docker compose up -d
```

### 4. Накатить схему и сидировать пресеты
```bash
pnpm db:generate   # сгенерировать SQL-миграцию из schema.ts → apps/web/drizzle/
pnpm db:migrate    # применить миграции
pnpm db:seed       # 4 пресета rules_profiles
```

> `pnpm db:push` тоже работает, но требует TTY (drizzle-kit может спросить
> подтверждение на destructive ops). В скриптах / неинтерактивных средах —
> используй `generate` + `migrate`.

### 5. Проверить
```bash
pnpm db:studio  # Drizzle Studio
pnpm test       # vitest — crypto + protected-routes
pnpm dev        # Next.js dev на :3000
```

> Если порт 3000 занят, Next.js возьмёт следующий свободный (например :3001),
> но `AUTH_URL` в `.env` останется `http://localhost:3000` — magic link и
> редиректы будут вести туда. Решение: освободи 3000 или поменяй `AUTH_URL`
> и перезапусти.

## Скрипты

| Скрипт | Что делает |
|---|---|
| `pnpm dev` | Next.js dev-сервер |
| `pnpm build` | прод-сборка |
| `pnpm test` | vitest run |
| `pnpm db:generate` | сгенерировать SQL-миграции из `lib/db/schema.ts` |
| `pnpm db:migrate` | применить миграции из `apps/web/drizzle/` |
| `pnpm db:push` | пушнуть схему напрямую (для dev — без миграций) |
| `pnpm db:studio` | Drizzle Studio UI |
| `pnpm db:seed` | посеять 4 пресета rules_profiles |

## Схема БД

Подробнее в [`goal.md`](./goal.md#схема-бд-drizzle). Источник правды:
[`apps/web/lib/db/schema.ts`](./apps/web/lib/db/schema.ts).

Критичные инварианты:
- AES-256-GCM шифрование WB-токенов (`lib/crypto/token.ts`).
- `decisions` — append-only audit-trail, каждое решение с `reason_code`.
- `minus_cache` — composite PK `(wb_account_id, advert_id, nm_id, phrase)` для
  идемпотентности воркера.
- Пресеты `rules_profiles` (`is_preset=true`, `user_id=NULL`) уникальны по
  имени через partial unique index — seed идемпотентен.

## Auth flow

- `/` — лендинг с кнопкой «Войти».
- `/login` — форма email → server action `signIn("resend", …)` → редирект
  на `/verify-request` (стандартный flow Auth.js).
- Письмо с magic link (subject: «Войти в WB Cleaner — нажмите ссылку»,
  ttl 15 минут). Клик по ссылке → `/dashboard`.
- Прямой заход на `/dashboard` / `/accounts` / `/decisions` / `/profiles`
  / `/settings` без сессии → редирект на `/login?callbackUrl=…`.
- Сессии хранятся в БД (`sessions` таблица, strategy: "database").

`middleware.ts` использует явный allowlist защищённых префиксов, чтобы новые
страницы случайно не оказались публичными.

## Воркер (Python)

Полная инструкция в [`apps/worker/README.md`](./apps/worker/README.md).
Короткое:

```bash
cd apps/worker
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest tests/       # 19 тестов
.venv/bin/python cli.py [--account-id <uuid>] [-v]
```

Воркер делит `.env` с `apps/web` (тот же `DATABASE_URL` и
`TOKEN_ENCRYPTION_KEY`). Расшифровка токенов в TS ↔ Python подтверждена
cross-language тестом через node-bridge.

### Импорт legacy `config.json`

```bash
.venv/bin/python scripts/migrate_legacy_config.py \
  --owner-email you@example.com \
  --config-path /tmp/wb_cleaner_legacy_config.json \
  --cache-path  /tmp/wb_cleaner_legacy_minus_cache.json \
  --cache-account-name "Магазин 1"
```

## Страницы

| Путь | Назначение |
|---|---|
| `/` | лендинг с кнопкой «Войти» |
| `/login` | форма email → magic link |
| `/verify-request` | «Проверьте почту» |
| `/dashboard` | последние прогоны по каждому WB-аккаунту |
| `/accounts` | список подключённых WB-аккаунтов |
| `/accounts/new` | онбординг: имя + JWT → проверка → шифрование → сохранение в preview |
| `/decisions` | таблица решений с фильтрами и пагинацией; «Восстановить» для applied excludes |

## Что не входит в эту итерацию

- UI-редактор профилей правил (`/profiles`) — следующая.
- Биллинг, команды, OAuth.
- Email-уведомления (только in-app пока).
- Биддер ставок (только минусация кластеров).

См. `apps/worker/README.md` для TODO по воркеру.
