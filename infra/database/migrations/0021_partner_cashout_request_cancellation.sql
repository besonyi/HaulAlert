-- A customer may cancel only before staff begins manual review. The original
-- reservation remains immutable; cancellation restores its gross amount with a
-- separately auditable reversal entry.

ALTER TABLE partner_ledger_entries
  DROP CONSTRAINT partner_ledger_entries_entry_type_check;

ALTER TABLE partner_ledger_entries
  ADD CONSTRAINT partner_ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'commission_available', 'refund_reversal', 'chargeback_clawback',
    'withdrawal', 'cashout_fee', 'cashout_reversal', 'manual_adjustment'
  ));

CREATE UNIQUE INDEX partner_ledger_cashout_reversal_once
  ON partner_ledger_entries (cashout_request_id)
  WHERE entry_type = 'cashout_reversal';
