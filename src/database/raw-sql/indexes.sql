CREATE INDEX idx_products_seller_created_at ON products (seller_id, created_at DESC);

CREATE INDEX idx_orders_pending_created_at ON orders (created_at DESC)
WHERE
  status = 'pending';

CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));

CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);