-- Keep the Stripe charge reference so refund and dispute events can reverse
-- exactly the commission they affect. Existing rows remain safely unlinked.

ALTER TABLE partner_commissions
  ADD COLUMN stripe_charge_id TEXT UNIQUE
  CHECK (stripe_charge_id IS NULL OR stripe_charge_id ~ '^ch_');
