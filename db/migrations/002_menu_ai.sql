-- Menu names are unique per restaurant (case-insensitive). It keeps the order screen
-- unambiguous and makes importing the same menu twice harmless.
CREATE UNIQUE INDEX menu_items_name_key ON menu_items (restaurant_id, lower(name));
CREATE UNIQUE INDEX menu_categories_name_key ON menu_categories (restaurant_id, lower(name));

-- One row per AI call: cost control (rate limit), cost reporting, and 3am debugging.
-- The pasted text itself is never stored.
CREATE TABLE ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  feature text NOT NULL CHECK (feature IN ('menu_import')),
  provider text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ok', 'invalid_output', 'provider_error', 'timeout')),
  input_chars integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_recent ON ai_requests (restaurant_id, created_at DESC);

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_requests
  USING (restaurant_id = app_restaurant_id())
  WITH CHECK (restaurant_id = app_restaurant_id());
GRANT SELECT, INSERT, UPDATE ON ai_requests TO sarfaresh_app;