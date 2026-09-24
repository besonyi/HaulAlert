-- Reclaims jobs stranded in `delivering` when a notification worker exits.
-- The lease timestamp itself is already stored in notification_deliveries.claimed_at.

CREATE INDEX notification_deliveries_claim_lease_idx
  ON notification_deliveries (claimed_at)
  WHERE status = 'delivering';
