-- Menu changes travel through the same event feed as order changes,
-- so every screen learns about them the same way (and we get an audit trail).
ALTER TABLE order_events ALTER COLUMN order_id DROP NOT NULL;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'order_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%order_opened%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE order_events DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE order_events ADD CONSTRAINT order_events_type_check CHECK (type IN
  ('order_opened','item_added','item_status_changed','item_cancelled','order_closed','menu_changed'));

-- Only menu events may lack an order.
ALTER TABLE order_events ADD CONSTRAINT order_events_order_required
  CHECK (type = 'menu_changed' OR order_id IS NOT NULL);