-- Migration 003: Payment Transaction Reference Support

ALTER TABLE parking_entries ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100);
ALTER TABLE exit_history ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100);
