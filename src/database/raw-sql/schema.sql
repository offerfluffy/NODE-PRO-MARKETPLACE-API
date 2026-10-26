CREATE TABLE
  users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('customer', 'seller', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now ()
  );

CREATE TABLE
  products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id bigint NOT NULL REFERENCES users (id),
    name text NOT NULL,
    description text NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents > 0),
    status text NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    image_url text,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector ('simple', name || ' ' || description)
    ) STORED
  );

CREATE TABLE
  inventories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint NOT NULL UNIQUE REFERENCES products (id),
    quantity_available integer NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now ()
  );

CREATE TABLE
  orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES users (id),
    status text NOT NULL CHECK (
      status IN ('pending', 'paid', 'cancelled', 'completed')
    ),
    total_amount_cents integer NOT NULL CHECK (total_amount_cents > 0),
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (customer_id, idempotency_key)
  );

CREATE TABLE
  order_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders (id),
    product_id bigint NOT NULL REFERENCES products (id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (order_id, product_id)
  );