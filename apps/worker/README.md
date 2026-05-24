# apps/worker — Python воркер

Анализирует рекламные кампании Wildberries и решает, какие поисковые
кластеры минусовать. Это адаптация существующего ядра, переписанная под
PostgreSQL вместо `config.json` / `minus_cache.json` / JSON-отчётов.

## Структура

```
apps/worker/
├── wb_cleaner_core/
│   ├── wb_cluster_optimizer.py  ← логика анализа, БЕЗ изменений с сервера
│   ├── multi_account_cleaner.py ← старый monolith (оставлен для сравнения)
│   ├── crypto.py                ← AES-256-GCM, совместимо с TS-стороной
│   ├── db.py                    ← psycopg3 клиент: runs/decisions/minus_cache
│   ├── db_minus_cache.py        ← drop-in замена MinusCache на БД
│   ├── reason_codes.py          ← маппинг Decision.rule → reason_code enum
│   └── runner.py                ← оркестратор: обёртка над WBClusterOptimizer
├── scripts/
│   ├── crypto_bridge.mjs        ← Node-мост для cross-language crypto-теста
│   └── migrate_legacy_config.py ← разовая миграция твоего config.json в БД
├── tests/                       ← pytest, в том числе cross-language
├── cli.py                       ← `python -m apps.worker.cli` для cron
└── requirements.txt
```

## Локальная установка

```bash
cd apps/worker
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Воркер читает `.env` из корня монорепо (`../../.env`). Обязательные:
- `DATABASE_URL` — тот же, что у `apps/web`.
- `TOKEN_ENCRYPTION_KEY` — **ТОТ ЖЕ САМЫЙ**, что в Next.js. Иначе токены
  не расшифруются.

## Запуск тестов

```bash
.venv/bin/python -m pytest tests/ -v
```

Тесты включают:
- 7 unit-тестов crypto (round-trip, tamper detection, env checks);
- 2 **cross-language**: TS-шифр → Python-расшифровка и обратно через
  `scripts/crypto_bridge.mjs` (Node). Бинарная совместимость с
  `apps/web/lib/crypto/token.ts` подтверждена этим тестом;
- 5 integration-тестов `db.py` против локального Postgres;
- 2 integration-теста миграции legacy;
- 3 unit-теста reason-code mapping.

Если Postgres не поднят — integration-тесты автоматически skip.

## Прогон воркера

```bash
# Все активные WB-аккаунты:
.venv/bin/python cli.py

# Один аккаунт:
.venv/bin/python cli.py --account-id <uuid>

# С отладочным логом:
.venv/bin/python cli.py -v
```

Аккаунт в `mode='preview'` (первые 7 дней после онбординга) → воркер
делает анализ и пишет `decisions`, но **НЕ** вызывает set-minus в WB.
Это критичный инвариант, проверяется в `runner.run_one_account`.

Аккаунт в `mode='auto'` → воркер реально применяет минусацию.

## Cron

Воркер сам не планирует запуски — это работа внешнего cron'а на сервере,
где он деплоится. Пример (раз в сутки в 6:30):

```
30 6 * * * /root/wb-cleaner/apps/worker/.venv/bin/python \
  /root/wb-cleaner/apps/worker/cli.py >> /var/log/wb-cleaner.log 2>&1
```

## Миграция legacy `config.json`

```bash
.venv/bin/python scripts/migrate_legacy_config.py \
  --owner-email me@example.com \
  --config-path  /path/to/old/config.json \
  --cache-path   /path/to/old/minus_cache.json \
  [--cache-account-name "Магазин 1"]
```

- Юзер по `--owner-email` создаётся, если нет.
- Аккаунты импортируются с `mode='auto'` (уже прод).
- minus_cache.json: если `--cache-account-name` задан — минусы попадают
  только в этот аккаунт; иначе во все аккаунты юзера (с
  `ON CONFLICT DO NOTHING`).
- Идемпотентно: повторный запуск ничего не задублирует.

## Инварианты

- Токены никогда не попадают в логи. Логировать только через
  `crypto.mask_token(token)` (последние 4 символа).
- Preview-режим = `WBClusterOptimizer(..., dry_run=True)`. set-minus в WB
  не вызывается, но decisions всё равно пишутся в БД.
- Rate-limit handling (батч 50 + `x-ratelimit-retry`) делает старый
  код в `WBAdvertAPI._request` — не трогать.
- `WB set-minus` — это **replace**, не append. См. комментарии в коде
  WB API клиента (TS-сторона) и наследованный `set_minus_clusters`.
