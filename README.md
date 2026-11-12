# Marketplace API

## 1. Що це за сервіс

Marketplace API - це backend для онлайн-маркетплейсу, схожого на Allegro. У сервісі продавці можуть публікувати товари, покупці можуть переглядати каталог і створювати замовлення, а адміністратори можуть керувати платформою та модерувати контент.

Головна проблема сервісу - коректне оформлення замовлень. Покупець не повинен випадково створити дубль замовлення через повторний запит, а система не повинна продавати більше одиниць товару, ніж реально є в наявності.

User stories:

- Як покупець, я хочу переглядати список товарів, щоб знайти потрібний товар.
- Як покупець, я хочу створити замовлення, щоб купити вибрані товари.
- Як покупець, я хочу безпечно повторити запит створення замовлення, щоб не отримати дубль замовлення після timeout або помилки мережі.
- Як продавець, я хочу додавати та редагувати товари, щоб продавати їх на платформі.
- Як продавець, я хочу керувати залишками товарів, щоб система не продавала недоступні товари.
- Як адміністратор, я хочу модерувати товари та користувачів, щоб підтримувати якість маркетплейсу.

## 2. Домен

Основні сутності домену:

| Сутність     | Зв'язки                                                                                      | Навіщо потрібна                                                |
| ------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| User         | може бути Customer, Seller або Admin; Customer має багато Orders; Seller має багато Products | Ідентифікація користувачів, ролей і прав доступу               |
| Product      | належить Seller; має один Inventory; входить в OrderItems                                    | Каталог товарів, які продавці публікують на платформі          |
| Inventory    | належить Product                                                                             | Зберігає доступну кількість товару та захищає від overselling  |
| Order        | належить Customer; має багато OrderItems; має Payment                                        | Оформлення покупки покупцем                                    |
| OrderItem    | належить Order і Product                                                                     | Зберігає конкретний товар, кількість і ціну в межах замовлення |
| Payment      | належить Order                                                                               | Фіксує оплату замовлення та її статус                          |
| Notification | належить User; може бути пов'язана з Order                                                   | Повідомляє покупця або продавця про важливі події              |

Перевірка домену:

| Вимога                                      | Як закривається                                           |
| ------------------------------------------- | --------------------------------------------------------- |
| >= 2 ролі користувачів із різними правами   | Customer, Seller, Admin                                   |
| Обмежений ресурс, за який конкурують        | `Inventory.quantity_available`                            |
| Операція з незворотним ефектом              | Створення `Order`, `OrderItem`, `Payment` і зміна залишку |
| Подія, про яку треба когось сповістити      | `OrderCreated`, `PaymentSucceeded`, `PaymentFailed`       |
| Сутність із файлами                         | Фото товару для `Product`                                 |
| Дані, які часто читають і рідко змінюють    | Каталог `Product`                                         |
| 4-6 сутностей зі зв'язками й важким запитом | Основна модель має 7 сутностей; зв'язки описані вище      |

Важкий запит для майбутніх ДЗ: список замовлень продавця з фільтром за статусом замовлення, статусом оплати, датою, покупцем і конкретним товаром. Такий запит потребує зв'язків між `Order`, `OrderItem`, `Product`, `Payment` і `User`.

## 3. Архітектурні рішення

Compute model: modular monolith. API буде одним Node.js застосунком, але код буде розділений за доменними модулями: `users`, `products`, `inventory`, `orders`, `payments`, `notifications`. Це спрощує запуск і деплой для курсового проєкту, але залишає зрозумілі межі між частинами домену.

Database: PostgreSQL. Сервісу потрібні транзакції для checkout, тому що створення замовлення, створення `OrderItem`, створення `Payment` і зменшення `Inventory` мають відбутися узгоджено. Якщо два покупці одночасно купують останню одиницю товару, база має допомогти не допустити overselling.

Async/event handling: outbox table first, worker later. Під час checkout API буде записувати події на кшталт `OrderCreated`, `PaymentSucceeded` або `PaymentFailed` в outbox-таблицю в тій самій PostgreSQL-транзакції, що й зміни замовлення. Пізніше окремий worker зможе читати ці події та створювати `Notification`, не втрачаючи події через тимчасову недоступність системи сповіщень.

Auth: JWT access tokens with RBAC. Користувач буде передавати `Authorization: Bearer <token>` у запитах до API. Token міститиме user id і роль, а API використовуватиме ролі `customer`, `seller` і `admin` для перевірки доступу до операцій над товарами, замовленнями та moderation-функціями.

Deploy: Docker Compose для локальної розробки. API буде запускатися як Node.js container, а PostgreSQL - як окремий database container. Такий підхід спрощує запуск після clean clone і залишає можливість пізніше додати Redis або worker container.

## 4. Trade-offs: WebSocket vs SSE

| Criterion               | WebSocket                                         | SSE                                                         |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Channel direction       | Bidirectional: client and server can send data    | One-way: server sends events to the client                  |
| Reconnection and replay | Must be implemented explicitly                    | Built-in reconnect; `Last-Event-ID` supports replay         |
| Infrastructure          | Needs upgrade/proxy support and a cluster adapter | Uses ordinary HTTP streaming and works through most proxies |
| Cost per event          | Compact frames after the initial handshake        | Adds text framing and HTTP connection overhead              |

For order-status notifications, I would keep SSE in production because the
data flow is one-way and reconnect/replay behavior is part of the protocol.
WebSocket remains useful when the client also needs to send frequent realtime
messages over the same connection.

With two API instances, Socket.IO rooms are local to each instance, so an
update handled by one instance can miss a client connected to another; a
Socket.IO Redis adapter with shared Pub/Sub makes room broadcasts available
across instances.

I am not starting with microservices. The domain has clear modules, but splitting them into separate services now would add network calls, distributed transactions and deployment complexity before the core API contract is stable.

I am not integrating a real payment provider in the first version. The project will model `Payment` and payment statuses first, because the course needs checkout correctness more than real money movement.

I am not adding a message broker immediately. The first async step will be an outbox table in PostgreSQL, because it is enough to persist events reliably and can later be connected to a worker or broker.

I am not adding Elasticsearch/OpenSearch at the start. Product search can begin with PostgreSQL filters and indexes; a separate search service only makes sense when search requirements become more complex.

I am not supporting multiple warehouses per product in the first version. Each product will have one inventory record, which is enough to practice stock reservation and overselling prevention.

## 5. Contract testing

Обрано варіант А — consumer-driven contract testing with Pact.

Consumer-тест описує взаємодію `GET /orders/1` між `marketplace-web` і
`marketplace-api` та створює виконуваний контракт у `pacts/`. Provider
verification запускає справжній Nest-застосунок із PostgreSQL Testcontainer,
готує provider state у базі та перевіряє відповідь застосунку проти контракту.
Pact Broker зберігає версії контрактів і результати їх перевірки; команди та
повний локальний Broker workflow наведені в розділі [Testing](#11-testing).

## 6. OpenAPI validation

Перевірка OpenAPI-спеки:

```bash
npx @redocly/cli lint openapi/openapi.yaml
```

Створення об'єднаної JSON-спеки:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
```

## 7. Configuration

Усі змінні конфігурації описані в `src/config/env.schema.ts` і перевіряються Zod під час запуску. Якщо обов'язкова змінна відсутня або значення некоректне, застосунок завершується з ненульовим кодом і повідомленням із назвою змінної та причиною помилки.

| Змінна             | Обов'язкова | Приклад / дефолт                           | Призначення                                                                                                |
| ------------------ | ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `PORT`             | Так         | `3000`                                     | Порт HTTP-сервера: ціле число від 1 до 65535.                                                              |
| `DB_URL`           | Так         | `postgres://app_user@127.0.0.1:21120/shop` | Адреса PgBouncer із протоколом `postgres:`. Пароль зберігається в окремому файлі.                          |
| `DB_PASSWORD_FILE` | Так         | `secrets/db_password`                      | Шлях до непорожнього файла з паролем користувача БД. Відносний шлях рахується від робочої теки застосунку. |
| `BROKER_URL`       | Так         | `amqp://app:app@127.0.0.1:21140`           | Адреса RabbitMQ для інтеграційних подій.                                                                   |
| `REDIS_URL`        | Так         | `redis://127.0.0.1:21150`                  | Окремий Redis для витіснюваного кешу карток товарів.                                                       |
| `REDIS_QUEUE_URL`  | Так         | `redis://127.0.0.1:21160`                  | Redis із `noeviction` для BullMQ, сесій і спільного rate limit.                                            |
| `LOG_LEVEL`        | Ні          | Дефолт: `info`                             | Допустимі значення: `debug`, `info`, `warn`, `error`.                                                      |
| `TIMEOUT_MS`       | Ні          | Дефолт: `5000`                             | Налаштування таймауту в мілісекундах: додатне ціле число.                                                  |

### Локальний запуск

1. Встанови залежності, увійди в Infisical і створи локальний файл пароля:

   ```bash
   npm ci
   infisical login
   mkdir -p secrets
   printf '%s' 'app-v1-password' > secrets/db_password
   ```

   Початковий пароль має збігатися з паролем `app_user` у
   `docker/postgres/init.sql`.
   `secrets/` і `.env` ігноруються Git та виключені з Docker-образу;
   `.env.example` залишається публічним контрактом конфігурації. Основний
   локальний шлях отримує змінні середовища `dev` з Infisical.

2. Перевір відповідність `.env.example` схемі та запусти PostgreSQL:

   ```bash
   npm run check:env
   docker compose up -d --wait
   ```

3. Запусти API в цьому терміналі:

   ```bash
   npm run start
   ```

   Команда збирає проєкт, запускає його через
   `scripts/with-secrets.sh dev` і отримує конфігурацію з Infisical. Для
   розробки з автоматичним перезапуском є `npm run start:dev`.

4. В іншому терміналі перевір API та з'єднання з БД:

   ```bash
   curl --fail http://localhost:3000/health
   curl --fail http://localhost:3000/db
   ```

   Якщо змінив `PORT`, використовуй відповідний порт у запитах.

### Ротація пароля БД без рестарту

`pg.Pool` перечитує файл `DB_PASSWORD_FILE` для кожного нового з'єднання. Скрипт `rotate.sh` працює з локальним Compose-сервісом `db`, користувачем `app_user` і файлом `secrets/db_password`, тому для цих кроків використовуй конфігурацію з `.env.example`. Потрібен `openssl`.

1. Залиш API запущеним. Перевір з'єднання та запам'ятай `uptimeSec`:

   ```bash
   curl --fail http://localhost:3000/db
   curl --fail http://localhost:3000/health
   ```

2. З кореня репозиторію виконай ротацію:

   ```bash
   bash rotate.sh
   ```

   Скрипт генерує новий пароль, виконує `ALTER ROLE`, синхронно оновлює
   `secrets/db_password` і `pgbouncer/userlist.txt`, перезавантажує конфігурацію
   PgBouncer, перевіряє нові credentials, а потім закриває старі з'єднання
   `app_user` через `pg_terminate_backend`.

3. Повтори перевірку:

   ```bash
   curl --fail http://localhost:3000/db
   curl --fail http://localhost:3000/health
   ```

   `/db` має повернути HTTP 200, а `uptimeSec` — бути більшим за попереднє значення: процес API продовжує працювати без рестарту.

Після видалення даних PostgreSQL (зокрема через `docker compose down -v`) нова
БД отримує початковий пароль з `docker/postgres/init.sql`, а локальний файл
і PgBouncer auth file можуть містити ротований. Перед запуском із новою БД
поверни обидва до початкового значення:

```bash
printf '%s' 'app-v1-password' > secrets/db_password
printf '%s\n' '"admin" "admin_bootstrap"' '"app_user" "app-v1-password"' \
  > pgbouncer/userlist.txt
docker compose up -d
```

## 8. TypeORM data layer

The PostgreSQL schema is represented by TypeORM entities in
`src/modules/database/entities`. Schema changes are applied through migrations;
`synchronize` is explicitly disabled so application startup cannot modify the
database schema implicitly.

### Commands

```bash
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run seed
npm run demo:nplus1
npm run report
```

### Seed

The seed is deterministic and idempotent. It checks for existing records before
inserting them, and all seed operations run in one transaction. Running
`npm run seed` repeatedly does not create duplicate rows.

| Table         | Expected rows |
| ------------- | ------------: |
| `users`       |             8 |
| `products`    |            10 |
| `inventories` |            10 |
| `orders`      |             6 |
| `order_items` |            11 |

The counts can be verified in PostgreSQL with:

```sql
SELECT 'users' AS table_name, count(*) FROM users
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'inventories', count(*) FROM inventories
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
ORDER BY table_name;
```

### N+1 demonstration

`npm run demo:nplus1` loads the graph `order -> items -> product` twice and
prints every generated SQL query.

| Strategy                   | SQL queries |
| -------------------------- | ----------: |
| Naive query inside a loop  |           7 |
| Nested TypeORM `relations` |           1 |

The naive version performs one query for the list of six orders and one query
per order. Its query count therefore grows with the number of orders. The fixed
version loads both relation levels using joins, so its query count remains one.

### Repository vs QueryBuilder

Repository methods are used when the result is an entity or an entity graph,
including ordinary filtering and relation loading. QueryBuilder is used when
the result is a custom projection requiring joins, aggregation, or grouping,
such as the revenue-per-seller report produced by `npm run report`.

PostgreSQL returns the report's `COUNT` and integer `SUM` aggregates as
`bigint`, so the `pg` driver exposes `orderCount` and `revenueCents` as strings.

### Deletion rules

`CASCADE` is used when the child has no meaning without its parent: inventory
follows its product, and order items follow their order. `RESTRICT` protects
business history: users referenced by products or orders cannot be removed, and
products referenced by order items cannot be removed.

## 9. Конкурентність

Checkout виконує декремент залишку, списання балансу, створення замовлення,
позиції замовлення та задачі на post-processing в одній транзакції. Якщо
будь-який крок завершується помилкою, PostgreSQL відкочує всю операцію, тому
частково створених замовлень не залишається.

### Захист від oversell

Для залишку використано атомарний умовний `UPDATE`: кількість зменшується лише
коли `quantity_available >= requested quantity`, а `RETURNING` одразу показує,
чи оновився рядок. PostgreSQL перевіряє умову і змінює рядок як одну операцію,
тому між окремими читанням і записом немає вікна для гонки. Це простіше для
одноразового декременту, ніж окремий `SELECT FOR UPDATE`, і не утримує блокування
під час виконання додаткової логіки застосунку.

Запуск `npm run demo:race` з початковим stock `10` дав:

| Показник                | Результат |
| ----------------------- | --------: |
| Паралельні спроби       |        50 |
| Успішні checkout        |        10 |
| Відхилені checkout      |        40 |
| Фінальний stock         |         0 |
| Рядки з від'ємним stock |         0 |

### Worker pool і `SKIP LOCKED`

Чотири конкурентні воркери забирають задачі через `FOR UPDATE SKIP LOCKED`.
Заблокований одним воркером рядок пропускається іншими, тому воркери не чекають
один на одного і не обробляють ту саму задачу одночасно. Статус задачі та
лічильник `processed` фіксуються в тій самій транзакції, що й її обробка.

Запуск `npm run demo:workers` дав:

| Показник             | Результат                        |
| -------------------- | -------------------------------- |
| Розподіл             | 3 задачі на кожного з 4 воркерів |
| Завершено            | 12/12                            |
| Оброблено двічі      | 0                                |
| Загальний час        | 326 ms                           |
| Послідовний орієнтир | 1200 ms                          |

### Retry транзакцій

Retry-обгортка повторює всю транзакцію з початку, включно з читаннями, і ловить
лише PostgreSQL-коди `40001` (serialization failure) та `40P01` (deadlock).
Ці помилки є тимчасовими наслідками конкурентного виконання, тому нова спроба
може завершитися успішно. Помилки валідації, порушення constraints та помилки
програмування повторювати не можна: retry не усуне їх причину і лише створить
зайве навантаження. Між спробами використовується exponential backoff із
jitter.

Запуск `npm run demo:retry` дав:

| Показник          |    Результат |
| ----------------- | -----------: |
| Спійманий код     |        40001 |
| Кількість retry   |            1 |
| Початковий баланс |        10000 |
| Операції          | +5000, -3000 |
| Фінальний баланс  |        12000 |
| Очікуваний баланс |        12000 |

Запуск демонстрацій:

```bash
npm run demo:race
npm run demo:workers
npm run demo:retry
```

## 10. Data layer ops

### PgBouncer transaction mode

PgBouncer uses transaction mode so that many application clients can share a
small pool of real PostgreSQL connections. A server connection is assigned only
for the duration of a transaction, so the next transaction may run on a
different connection. As a result, session-level `SET` values,
`LISTEN`/`NOTIFY` subscriptions, and session advisory locks cannot be expected
to survive between transactions. Named prepared statements also require
PgBouncer's `max_prepared_statements` support, which is enabled in this project.

### Start the data layer

Start PostgreSQL and PgBouncer and wait for both health checks:

```bash
docker compose up -d --wait
```

The application connects through PgBouncer on host port `21120`; PostgreSQL's
direct development port `21110` remains available for administrative TypeORM
operations. A host-side connectivity check is:

```bash
PGPASSWORD=app-v1-password psql \
  -h 127.0.0.1 -p 21120 -U app_user -d shop \
  -c "SELECT 1 AS result, current_user;"
```

### Backup

The normal development path injects `DATABASE_URL` from the Infisical `dev`
environment. The script requires PostgreSQL 16 `pg_dump`, creates a dated
custom-format PostgreSQL archive under `backups/`, and prints its path:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```

The archive can be inspected with:

```bash
pg_restore --list backups/<printed-file-name>.dump
```

`backup.cron` runs the same backup command every night at 02:00. It is prepared
for a Linux server with PostgreSQL 16 client tools under
`/usr/lib/postgresql/16/bin`; set `APP_DIR` in that file to the actual deployment
directory before installing the crontab.

### Restore drill

The drill selects the newest dump, creates an isolated Compose project with a
new empty PostgreSQL container and volume, restores the archive, and compares
the `orders` row count and total amount with the source database. It prints
`MATCH` on success and removes that run's temporary project and volume on exit,
so parallel drills cannot delete each other's restore targets:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

The measured drill result and the RTO/RPO calculation are recorded in
`RESTORE-DRILL.md`.

## 11. Testing

Docker має бути запущений, оскільки integration, E2E та provider verification
створюють `postgres:16-alpine` через Testcontainers.

Основні команди:

```bash
npx tsc --noEmit
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

### Integration tests

```bash
npm run test:integration
```

Integration tests start `postgres:16-alpine` through Testcontainers, apply all
TypeORM migrations, and verify the repositories against a real PostgreSQL
database.

To verify that the tests are repeatable:

```bash
npm run test:integration && npm run test:integration
```

### Test isolation

A separate PostgreSQL container is created for each test suite. Before every
repository test, the database is cleaned with:

```sql
TRUNCATE users RESTART IDENTITY CASCADE;
```

The tests use `TRUNCATE` because the checkout logic manages its own
transactions, and an outer `BEGIN`/`ROLLBACK` could conflict with those
transaction boundaries. `RESTART IDENTITY` resets generated IDs, while
`CASCADE` clears the related tables.

### E2E tests

```bash
npm run test:e2e
```

E2E tests build the Nest application with `AppModule` and receive the database
URL from a PostgreSQL Testcontainer. External RabbitMQ, Redis and BullMQ
providers are replaced with deterministic test doubles; database repositories
and checkout still use the real PostgreSQL container. The suite covers a
missing-order `404`, reading a seeded order, and the complete multi-item
checkout flow: create, read back, inventory and balance changes,
post-processing job creation, and idempotent retry.

### Consumer contract and local provider verification

Generate the Pact contract as the imaginary frontend consumer:

```bash
npm run test:contract
ls pacts/*.json
grep providerStates pacts/*.json
```

Verify the generated local Pact against the real Nest application:

```bash
npm run verify:provider
```

The consumer test talks to Pact's mock server. Provider verification is the
opposite side: it starts the real application, uses the provider state
`order with id 1 exists` to seed its Testcontainer database, and replays the
contract request against that application.

### Pact Broker and `can-i-deploy`

Docker Compose runs two contract-specific services in addition to the
Marketplace data layer:

- `pact-broker` is the HTTP registry for contracts, versions, verification
  results and deployment compatibility checks. It is available locally at
  `http://127.0.0.1:21130`.
- `broker-db` is the Broker's private PostgreSQL database. It contains contract
  metadata, not marketplace users, products or orders.

Start the Broker, generate the contract and publish consumer version `1.0.0`:

```bash
docker compose up -d --wait
npm run test:contract

curl --fail-with-body -i -X PUT \
  'http://127.0.0.1:21130/pacts/provider/marketplace-api/consumer/marketplace-web/version/1.0.0' \
  -H 'Content-Type: application/json' \
  --data-binary @pacts/marketplace-web-marketplace-api.json
```

The normal local path obtains `PACT_BROKER_URL` and, for an authenticated remote
Broker, `PACT_BROKER_TOKEN` from Infisical:

```bash
bash scripts/with-secrets.sh dev npm run verify:provider
```

The grader does not have access to the project's secret store, so the equivalent
emergency path supplies the local Broker URL directly. `PROVIDER_VERSION` is an
immutable application version, not a secret:

```bash
PACT_BROKER_URL=http://127.0.0.1:21130 \
PROVIDER_VERSION=1.0.0 \
PROVIDER_BRANCH=main \
npm run verify:provider
```

With `PACT_BROKER_URL` present, `verify:provider` downloads the contract from the
Broker and publishes its successful verification result. Before any provider
version is tagged as production, the deployment query is deliberately blocked:

```bash
curl --silent \
  'http://127.0.0.1:21130/can-i-deploy?pacticipant=marketplace-web&version=1.0.0&to=prod'
```

```json
{
  "deployable": null,
  "reason": "There is no verified pact between version 1.0.0 of marketplace-web and the latest version of marketplace-api with tag prod (no such version exists)",
  "success": 0,
  "failed": 0,
  "unknown": 1
}
```

Tag provider version `1.0.0` as the version currently representing production:

```bash
curl --fail-with-body -i -X PUT \
  'http://127.0.0.1:21130/pacticipants/marketplace-api/versions/1.0.0/tags/prod' \
  -H 'Content-Type: application/json'
```

The tag does not deploy code. It gives `to=prod` a concrete provider version to
compare with the consumer contract. Repeating the same `can-i-deploy` query now
returns:

```json
{
  "deployable": true,
  "reason": "All required verification results are published and successful",
  "success": 1,
  "failed": 0,
  "unknown": 0
}
```

This `null` to `true` transition proves that the gate depends on an actual
published verification result and production provider version. In CI,
`PACT_BROKER_URL` and `PACT_BROKER_TOKEN` come from GitHub secrets,
`PROVIDER_VERSION` is the commit SHA, and `PROVIDER_BRANCH` is the Git branch.

### GitHub Actions contract gate

The workflow in `.github/workflows/contract.yml` runs for every pull request
and for pushes to `main`:

```yaml
on:
  pull_request:
  push:
    branches:
      - main
```

A push to a branch with an open pull request therefore creates one
`pull_request` run. After the pull request is merged, the resulting push to
`main` creates one more run. Restricting the `push` trigger to `main` avoids the
duplicate `push` and `pull_request` runs that would otherwise execute for every
commit on a PR branch.

The `contract` job performs the compatibility workflow in this order:

1. Check out the exact Git commit and install dependencies with `npm ci`.
2. Run `npm run test:contract` to generate the consumer Pact.
3. Publish the Pact as `marketplace-web@${GITHUB_SHA}`.
4. Run the real provider against PostgreSQL Testcontainers and publish the
   verification as `marketplace-api@${GITHUB_SHA}`.
5. Ask whether that consumer version can work with the provider version tagged
   `prod`. The job exits with code `1` unless `deployable` is exactly `true`.

The workflow requires these GitHub Actions repository secrets:

| Secret              | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `PACT_BROKER_URL`   | Public HTTPS URL of the PactFlow tenant or another remote Broker     |
| `PACT_BROKER_TOKEN` | Read/write Broker API token; never store the value in the repository |

`CONSUMER_VERSION`, `PROVIDER_VERSION` and `PROVIDER_BRANCH` are derived from
GitHub metadata and are not secrets. The local Compose URL
`http://127.0.0.1:21130` cannot be used by GitHub-hosted runners because their
loopback interface does not point to the developer machine.

The `prod` tag belongs to one Broker only. A tag created in the local Compose
Broker is not copied to PactFlow. A new remote Broker therefore needs a one-time
bootstrap after its first successful provider verification:

```bash
PROVIDER_VERSION='<verified-provider-commit-sha>'

curl --fail-with-body -i -X PUT \
  "${PACT_BROKER_URL%/}/pacticipants/marketplace-api/versions/${PROVIDER_VERSION}/tags/prod" \
  -H "Authorization: Bearer ${PACT_BROKER_TOKEN}" \
  -H 'Content-Type: application/json'
```

After a real provider deployment, the same operation must tag the commit that
was actually deployed. It belongs after deployment, not before
`can-i-deploy`; tagging a PR candidate merely to make CI green would falsely
claim that candidate is already running in production.

Once production state has been bootstrapped, a new Git commit with unchanged
Pact content remains deployable because the production provider has already
verified that contract content. This was confirmed by a second CI run with a
new commit SHA and an unchanged Pact. If the consumer contract changes,
`deployable: null` or `false` is a legitimate block until the production
provider is proven compatible; it should not be bypassed by moving the tag.

## 12. Realtime verification

Run the API on `http://localhost:3000`, then use an existing seeded order:

```bash
export ORDER_ID=1
export CUSTOMER_ID=3
```

`x-user-id` is the temporary HTTP identity used by this homework until JWT
authentication is introduced. The SSE endpoint returns `401` without it and
`403` when the customer does not own the order.

Verify the SSE response header:

```bash
curl -sN --max-time 2 -D - -o /dev/null \
  -H "x-user-id: $CUSTOMER_ID" \
  "http://localhost:3000/orders/$ORDER_ID/events" |
  grep -i '^content-type'
```

To inspect a live event, keep this command open in one terminal:

```bash
curl -sN --max-time 5 \
  -H "x-user-id: $CUSTOMER_ID" \
  "http://localhost:3000/orders/$ORDER_ID/events"
```

While it is connected, change the status from another terminal:

```bash
curl --fail-with-body -i -X PATCH \
  -H 'content-type: application/json' \
  -d '{"status":"paid"}' \
  "http://localhost:3000/orders/$ORDER_ID/status"
```

Create at least four events and verify replay after event `3`:

```bash
for next_status in paid completed cancelled paid; do
  curl --fail-with-body -X PATCH \
    -H 'content-type: application/json' \
    -d "{\"status\":\"$next_status\"}" \
    "http://localhost:3000/orders/$ORDER_ID/status" \
    -o /dev/null
done

curl -sN --max-time 2 \
  -H "x-user-id: $CUSTOMER_ID" \
  -H 'Last-Event-ID: 3' \
  "http://localhost:3000/orders/$ORDER_ID/events" |
  grep '^id:' |
  head -1
```

Run the room-isolation demo in both modes:

```bash
npm run demo:realtime
npm run demo:realtime -- --same-room
```

The first command prints `A_RECEIVED=1` and `B_RECEIVED=0`; the control mode
prints `A_RECEIVED=1` and `B_RECEIVED=1`. Both commands exit with code `0`.

## 13. Async-події через RabbitMQ

Order checkout publishes an explicit `order.placed` contract to the durable
topic exchange `shop.events`. The consumer-owned topology binds the durable
quorum queue `shop.order-placed` with routing key `order.placed`. Permanent
failures are rejected without requeue and routed through `shop.events.dlx` to
the separate quorum queue `shop.order-placed.dlq`.

The publisher reuses a confirm channel, marks messages persistent and waits for
`waitForConfirms()`. The consumer uses `noAck: false`, applies the database
effect first and acknowledges only afterward. Its effect is an
`order_post_processing` job whose `event_id` has a PostgreSQL unique index;
`INSERT ... ON CONFLICT (event_id) DO NOTHING` makes repeated delivery return
`skipped` instead of creating a second job.

Create the durable topology independently of the publisher:

```bash
npm run rabbitmq:bootstrap
```

The demos are self-cleaning and intentionally fail when the production API is
still consuming the work queue. The recorded happy-path run was:

```text
published=5
delivered=5
effect=5
acked=5
dlq=0
prefetch=10
```

The configured `prefetch=10` suits the short single-row PostgreSQL effect. The
demo enforces a 10-second upper bound for the complete five-message run; even
using that as a deliberately pessimistic per-message bound gives
`10 × 10 s = 100 s < 1,800 s`, the stock RabbitMQ consumer timeout. A prefetch
of one would unnecessarily serialize these short operations.

The poison-message run rejected a schema-invalid event and read the broker's
reason from `x-first-death-reason`/`x-death`:

```text
rejected=1
work=0
dlq=1
dlq-reason=rejected
effect=0
```

The duplicate run deliberately applies the effect and then performs one
controlled `nack(message, false, true)`. RabbitMQ redelivers the same message
with `redelivered=true`; the unique `event_id` turns the second effect into a
no-op before the message is acknowledged:

```text
deliveries=2
effect=1
skipped=1
```

This is **at-least-once delivery**, not exactly-once delivery. An acknowledgement
can be lost after the effect commits, so RabbitMQ may deliver the event again.
The stable event ID and idempotent database insert produce an exactly-once
result even when delivery is repeated. A separate gap still exists between the
order transaction committing and the publisher sending the event. The
transactional outbox described below closes that dual-write gap.

## 14. Outbox та ідемпотентність

Checkout no longer publishes directly to RabbitMQ. It writes the order, order
items and an explicit `order.placed` event contract to PostgreSQL in one
transaction. Either the business state and its outbox row commit together, or
both roll back. The event payload is constructed explicitly instead of
serializing a TypeORM entity, so database column changes do not silently become
breaking changes for consumers.

The polling relay uses this sequence:

```text
SELECT pending rows ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
→ publish and wait for RabbitMQ confirms
→ UPDATE published_at and attempts
→ COMMIT
```

`SKIP LOCKED` lets multiple relay processes claim different rows without
waiting for each other. The `ORDER BY` controls selection order only; it does
not guarantee global delivery order once several relays run concurrently. If
strict order becomes a domain requirement, it must be enforced per
`aggregate_id` through broker partitioning or an equivalent per-aggregate
serialization strategy. The relay searches by `published_at IS NULL`, not by
an increasing identity cursor: identity values are allocated before commit, so
a cursor can skip a lower ID that becomes visible later.

The consumer implements two layers of idempotency in one PostgreSQL
transaction. The inbox row uses the composite key `(message_id, consumer)` and
`ON CONFLICT DO NOTHING`; the `order_post_processing` job also has the natural
unique key `event_id`. The inbox marker and effect commit together. At the HTTP
edge, repeated checkout requests with the same `Idempotency-Key` return the
original order instead of creating a second order or event.

The three demos reset their own fixture rows and RabbitMQ queues, validate the
persisted counts, and exit non-zero if an invariant fails. They also refuse to
run while another consumer owns the work queue. Recorded local runs:

```text
$ npm run demo:outbox
requests=2
orders=1
outbox=1
published=1
deliveries=1
effect=1
processed=1
```

```text
$ npm run demo:crash-write
write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0
```

`demo:crash-write` injects an exception immediately after the outbox insert in
the real checkout transaction. The transaction rolls back the order and outbox
row together, so nothing reaches RabbitMQ.

```text
$ npm run demo:crash-relay
published=2
deliveries=2
applied=1
effect=1
processed=1
```

`demo:crash-relay` uses a real child relay process. After RabbitMQ confirms the
first publish, the parent sends `SIGKILL` before the relay can update
`published_at`. PostgreSQL rolls back the interrupted relay transaction, so a
restarted relay sees the row as pending and publishes it again. The consumer
receives the event twice, but the inbox and natural effect key allow only one
application.

The relay order cannot be changed to `UPDATE published_at` before `publish`.
If the process or broker fails after that update, the event is marked complete
without ever leaving PostgreSQL and no retry can find it. Publishing first can
produce a duplicate when the process dies or the broker acknowledgement is
lost, but that failure is recoverable through the idempotent consumer. The
choice is therefore recoverable duplication instead of permanent loss.

Published outbox rows are retained for seven days for diagnostics, then a
scheduled maintenance job should delete only rows with
`published_at < now() - interval '7 days'` in small batches. Unpublished rows
must never be removed by retention. `processed_messages` needs a retention
window at least as long as the maximum broker redelivery/replay window; until
that operational window is defined, its rows are retained.

## 15. Redis: кеш, сесії, ліміти, черга

### Два Redis-інстанси

Кеш і BullMQ мають несумісні вимоги до пам'яті. `redis-cache` слухає host-порт
`21150`, має ліміт `64mb` і політику `allkeys-lru`: коли пам'ять заповнюється,
Redis може витіснити давно не використаний кешований ключ. `redis-queue`
слухає `21160` і використовує `noeviction`, бо довільне видалення внутрішніх
ключів BullMQ пошкодило б стан черги. Ці політики діють на весь Redis-процес,
тому `SELECT 0`/`SELECT 1` не дають потрібної ізоляції — потрібні два окремі
контейнери.

`noeviction` саме по собі не переживає рестарт. Для чергового Redis увімкнено
AOF з `appendfsync everysec`, а `/data` змонтовано в named volume. Це дає
практичний компроміс між швидкістю та персистентністю: при аварії можна втратити
приблизно останню секунду записів, але контейнерний рестарт не починає з
порожнього Redis.

### Cache-aside і захист від stampede

`GET /products/:id` повертає реальну важку проєкцію: товар, продавця, залишок і
агреговану кількість проданих одиниць. У Redis зберігається готовий DTO, а не
TypeORM entity. На промаху сервіс читає PostgreSQL, перевіряє результат через
Zod і записує JSON із TTL `300..360` секунд. Випадковий jitter не дає ключам,
прогрітим одним циклом, протухнути одночасно.

Для холодного популярного ключа використано single-flight:

```text
GET cache
→ SET lock:<key> <uuid> NX PX 5000
→ лідер повторно перевіряє кеш і читає PostgreSQL
→ waiters коротко опитують кеш
→ Lua compare-and-delete знімає тільки лок із тим самим UUID
```

Повторна перевірка після захоплення лока потрібна, бо інший лідер міг устигнути
заповнити кеш між першим `GET` і `SET NX`. Після успішного checkout ключі
зачеплених товарів інвалідуються best-effort уже після commit; TTL залишається
обов'язковою страховкою. Помилки читання або запису кеша перетворюються на
промах і запит продовжується через PostgreSQL.

Якщо stampede-лок зламається, протухне занадто рано або waiter не дочекається,
кілька запитів можуть одночасно виконати однаковий `SELECT`. Тут це прийнятно:
ми платимо за зайве читання, але не псуємо бізнес-стан. Лок є оптимізацією, а
не гарантією коректності checkout.

### Сесії з rolling TTL

Сесійний стан зберігається в `redis-queue`, а не в кеш-інстансі. Інакше
`allkeys-lru` міг би витіснити активну сесію до завершення TTL і випадково
розлогінити користувача. Стан живе поза процесом API, тому переживає рестарт
application client; AOF і volume додатково захищають від рестарту Redis-
контейнера.

Створення використовує `SET ... EX 1800`, а кожне читання — атомарний
`GETEX ... EX 1800`. Активність користувача одночасно читає сесію й повертає
TTL до 30 хвилин, без проміжку між окремими `GET` та `EXPIRE`.

### Спільний sliding-window rate limit

Картка товару захищена спільним лімітом `5` запитів за `10` секунд. Вибрано
sliding window, щоб уникнути граничного сплеску fixed window: п'ять запитів
перед межею і ще п'ять одразу після неї не повинні перетворювати ліміт `5` на
фактичні `10` за короткий інтервал.

Мітки запитів зберігаються в Redis ZSET. Lua-скрипт атомарно видаляє старі
мітки, рахує активні й додає нову. Тому два pod-и не можуть одночасно побачити
останнє вільне місце й обидва пропустити запит. Перевищення повертає HTTP `429`
і `Retry-After: 10`.

### RabbitMQ і BullMQ

RabbitMQ переносить інтеграційну подію між частинами системи та відповідає за
routing, ACK/requeue і DLQ. BullMQ виконує локальну фонову роботу цього сервісу:
retry з exponential backoff і jitter, дедуплікацію за стабільним `jobId`,
retention завершених задач і scheduling.

Повний ланцюжок:

```text
checkout transaction
→ PostgreSQL outbox
→ relay
→ RabbitMQ order.placed
→ idempotent database effect
→ BullMQ order post-processing
→ worker
```

RabbitMQ ACK надсилається лише після commit database effect і успішного
BullMQ `add`. Якщо enqueue не вдався, повідомлення requeue-иться; повторний
database effect повертає `skipped`, а стабільний colon-free `jobId`
`order-placed-<orderId>` не створює дубль. Задача має три спроби, exponential
backoff із jitter і не видаляється одразу після completion. Worker використовує
окреме ioredis-з'єднання з `maxRetriesPerRequest: null` та ідемпотентно переводить
рядок `jobs` із `pending` у `done`.

### Виміряні демонстрації

Усі чотири демо самоочисні та друкують машинозчитувані рядки `key=number`.
Зафіксовані локальні прогони:

```text
$ npm run demo:cache
cache-lru=1
cache-maxmemory=1
warmed=50
ttl-distinct=35
concurrent=20
db-calls=1
db-calls-warm=0
```

`db-calls` рахує реальні SQL-запити через TypeORM logger. Після видалення одного
ключа 20 конкурентних читань дали один SQL-запит; наступні 100 теплих читань —
жодного.

```text
$ npm run demo:session
requests=3
sessions=1
in-redis=1
ttl-renewed=1
survived-restart=1
```

```text
$ npm run demo:ratelimit
instances=2
limit=5
requests=8
allowed=5
blocked=3
status=429
retry-after=1
```

```text
$ npm run demo:queue
queue-noeviction=1
attempts=3
completed=1
added=2
queued=1
schedulers=1
scheduled-runs=2
```

`demo:queue` двічі викликає актуальний для BullMQ 6
`upsertJobScheduler` з одним scheduler ID. У Redis залишається один scheduler,
який виконав щонайменше дві заплановані задачі.

## Grading

The grader has no access to Infisical. `SKIP_VAULT=1` tells the same wrapper to
use the variables exported from the local Docker Compose development
credentials instead. `DB_URL` is used by the API, `DATABASE_URL` is used by
the backup scripts, and the `DB_*` variables are used by TypeORM commands:

```bash
docker compose up -d --wait

export DATABASE_URL=postgres://admin:admin_bootstrap@127.0.0.1:21120/shop
mkdir -p secrets
printf '%s' 'app-v1-password' > secrets/db_password
export DB_URL=postgres://app_user@127.0.0.1:21120/shop
export DB_PASSWORD_FILE=secrets/db_password
export SKIP_VAULT=1
export PORT=3000
export BROKER_URL=amqp://app:app@127.0.0.1:21140
export REDIS_URL=redis://127.0.0.1:21150
export REDIS_QUEUE_URL=redis://127.0.0.1:21160

export DB_HOST=127.0.0.1
export DB_PORT=21110
export DB_USER=admin
export DB_PASSWORD=admin_bootstrap
export DB_NAME=shop

npm ci
npm run build
npx tsc --noEmit
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed
npm run seed
npm run rabbitmq:bootstrap
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
npm run demo:nplus1
npm run report
npm run demo:race
npm run demo:workers
npm run demo:retry
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue

bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

After the setup commands finish, start `npm run start` in one terminal and run
the commands from [Realtime verification](#12-realtime-verification) in another.
