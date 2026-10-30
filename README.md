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

## 4. Trade-offs

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
| `PORT`             | Так         | `21100`                                    | Порт HTTP-сервера: ціле число від 1 до 65535.                                                              |
| `DB_URL`           | Так         | `postgres://app_user@127.0.0.1:21120/shop` | Адреса PgBouncer із протоколом `postgres:`. Пароль зберігається в окремому файлі.                          |
| `DB_PASSWORD_FILE` | Так         | `secrets/db_password`                      | Шлях до непорожнього файла з паролем користувача БД. Відносний шлях рахується від робочої теки застосунку. |
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
   curl --fail http://localhost:21100/health
   curl --fail http://localhost:21100/db
   ```

   Якщо змінив `PORT`, використовуй відповідний порт у запитах.

### Ротація пароля БД без рестарту

`pg.Pool` перечитує файл `DB_PASSWORD_FILE` для кожного нового з'єднання. Скрипт `rotate.sh` працює з локальним Compose-сервісом `db`, користувачем `app_user` і файлом `secrets/db_password`, тому для цих кроків використовуй конфігурацію з `.env.example`. Потрібен `openssl`.

1. Залиш API запущеним. Перевір з'єднання та запам'ятай `uptimeSec`:

   ```bash
   curl --fail http://localhost:21100/db
   curl --fail http://localhost:21100/health
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
   curl --fail http://localhost:21100/db
   curl --fail http://localhost:21100/health
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

E2E tests build the full Nest application with `AppModule` and no replaced
providers. The application receives its database URL from a PostgreSQL
Testcontainer. The suite covers a missing-order `404`, reading a seeded order,
and the complete multi-item checkout flow: create, read back, inventory and
balance changes, post-processing job creation, and idempotent retry.

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

## Grading

The grader has no access to Infisical. `SKIP_VAULT=1` tells the same wrapper to
use the variables exported from the local Docker Compose development
credentials instead. `DATABASE_URL` goes through PgBouncer; the `DB_*`
variables are used by the TypeORM commands:

```bash
docker compose up -d --wait

export DATABASE_URL=postgres://admin:admin_bootstrap@127.0.0.1:21120/shop
export SKIP_VAULT=1

export DB_HOST=127.0.0.1
export DB_PORT=21110
export DB_USER=admin
export DB_PASSWORD=admin_bootstrap
export DB_NAME=shop

npm ci
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed
npm run seed
npm run demo:nplus1
npm run report
npm run demo:race
npm run demo:workers
npm run demo:retry

bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```
