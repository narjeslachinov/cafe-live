-- ===== Helper: current tenant (fails closed when unset) =====
CREATE FUNCTION app_restaurant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.restaurant_id', true), '')::uuid
$$;

-- ===== Identity & tenancy =====
CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global table: the app role gets NO direct access (see auth_find_login below).
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TYPE staff_role AS ENUM ('waiter', 'kitchen', 'manager');

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  role staff_role NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, restaurant_id)
);

-- ===== Floor =====
CREATE TABLE dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 20),
  seats integer NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 50),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, label),
  UNIQUE (id, restaurant_id)
);

-- ===== Menu =====
CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (id, restaurant_id)
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description text CHECK (length(description) <= 300),
  price_toman integer NOT NULL CHECK (price_toman >= 0),
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_categories (id, restaurant_id),
  UNIQUE (id, restaurant_id)
);

-- ===== Orders =====
CREATE TYPE order_status AS ENUM ('open', 'closed', 'cancelled');
CREATE TYPE item_status AS ENUM ('new', 'preparing', 'ready', 'served', 'cancelled');

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL,
  status order_status NOT NULL DEFAULT 'open',
  opened_by uuid NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  FOREIGN KEY (table_id, restaurant_id) REFERENCES dining_tables (id, restaurant_id),
  UNIQUE (id, restaurant_id),
  CHECK ((status = 'open') = (closed_at IS NULL))
);
-- At most ONE open order per table, enforced by the database.
CREATE UNIQUE INDEX one_open_order_per_table
  ON orders (restaurant_id, table_id) WHERE status = 'open';

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  name_snapshot text NOT NULL,
  unit_price_toman integer NOT NULL CHECK (unit_price_toman >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  note text CHECK (length(note) <= 200),
  status item_status NOT NULL DEFAULT 'new',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id),
  FOREIGN KEY (menu_item_id, restaurant_id) REFERENCES menu_items (id, restaurant_id),
  UNIQUE (restaurant_id, request_id)   -- idempotency key
);
CREATE INDEX order_items_by_order ON order_items (order_id);
CREATE INDEX order_items_kitchen_queue ON order_items (restaurant_id, created_at)
  WHERE status IN ('new', 'preparing', 'ready');

CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  order_item_id uuid,
  type text NOT NULL CHECK (type IN
    ('order_opened','item_added','item_status_changed','item_cancelled','order_closed')),
  payload jsonb NOT NULL DEFAULT '{}',
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_feed ON order_events (restaurant_id, id);

-- ===== Row Level Security =====
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurants
  USING (id = app_restaurant_id()) WITH CHECK (id = app_restaurant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','dining_tables','menu_categories','menu_items',
    'orders','order_items','order_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (restaurant_id = app_restaurant_id())
         WITH CHECK (restaurant_id = app_restaurant_id())', t);
  END LOOP;
END $$;

-- ===== Least-privilege grants (note: no DELETE anywhere) =====
GRANT USAGE ON SCHEMA public TO sarfaresh_app;
GRANT SELECT ON restaurants TO sarfaresh_app;
GRANT SELECT, INSERT, UPDATE ON memberships, dining_tables, menu_categories,
  menu_items, orders, order_items TO sarfaresh_app;
GRANT SELECT, INSERT ON order_events TO sarfaresh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sarfaresh_app;

-- ===== Login lookup: the only way the app touches `users` =====
CREATE FUNCTION auth_find_login(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, restaurant_id uuid,
               role staff_role, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, m.restaurant_id, m.role, m.display_name
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  WHERE lower(u.email) = lower(p_email) AND m.is_active
$$;
REVOKE ALL ON FUNCTION auth_find_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_login(text) TO sarfaresh_app;