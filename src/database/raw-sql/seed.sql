BEGIN;

INSERT INTO
  users (email, password_hash, full_name, role)
SELECT
  'user' || g || '@example.com',
  'test' || g,
  'Користувач ' || g,
  CASE
    WHEN g <= 15000 THEN 'customer'
    WHEN g <= 19990 THEN 'seller'
    ELSE 'admin'
  END
FROM
  generate_series (1, 20000) AS g;

INSERT INTO
  products (
    seller_id,
    name,
    description,
    price,
    status,
    image_url
  )
SELECT
  15001 + MOD(g - 1, 4990),
  CASE
    WHEN MOD(g, 100) = 0 THEN 'Шкіряні кросівки модель ' || g
    ELSE 'Товар модель ' || g
  END,
  CASE
    WHEN MOD(g, 250) = 0 THEN 'Зручний чохол для кросівок'
    ELSE 'Якісний товар з українського каталогу'
  END,
  (1000 + MOD(g, 50000)) / 100.0,
  CASE
    WHEN MOD(g, 100) < 90 THEN 'active'
    WHEN MOD(g, 100) < 97 THEN 'draft'
    ELSE 'archived'
  END,
  'https://example.com/products/' || g || '.jpg'
FROM
  generate_series (1, 100000) AS g;

INSERT INTO
  inventories (product_id, quantity_available)
SELECT
  g,
  CASE
    WHEN MOD(g, 10) = 0 THEN 0
    ELSE 1 + MOD(g, 100)
  END
FROM
  generate_series (1, 100000) AS g;

INSERT INTO
  orders (
    customer_id,
    status,
    total_amount,
    idempotency_key,
    created_at
  )
SELECT
  1 + MOD(g - 1, 15000),
  CASE
    WHEN MOD(g, 100) < 5 THEN 'pending'
    WHEN MOD(g, 100) < 8 THEN 'cancelled'
    WHEN MOD(g, 100) < 15 THEN 'paid'
    ELSE 'completed'
  END,
  (2000 + 2 * MOD(g, 50000)) / 100.0,
  'order-' || g,
  timestamptz '2025-01-01 00:00:00+00' + MOD(g, 365) * interval '1 day'
FROM
  generate_series (1, 100000) AS g;

INSERT INTO
  order_items (order_id, product_id, quantity, unit_price)
SELECT
  order_no,
  MOD(order_no - 1 + (item_no - 1) * 50000, 100000) + 1,
  1,
  (1000 + MOD(order_no, 50000)) / 100.0
FROM
  generate_series (1, 100000) AS order_no
  CROSS JOIN generate_series (1, 2) AS item_no;

COMMIT;

VACUUM (ANALYZE);