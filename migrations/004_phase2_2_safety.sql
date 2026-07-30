-- Migration 004: Phase 2.2 — Production Safety & Test Isolation
-- Adds test_run_id column so test records can be tagged and scoped for cleanup.
-- Non-destructive additive change.

ALTER TABLE parking_entries ADD COLUMN IF NOT EXISTS test_run_id VARCHAR(64);
ALTER TABLE exit_history ADD COLUMN IF NOT EXISTS test_run_id VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS test_run_id VARCHAR(64);

-- Index for fast test-data cleanup
CREATE INDEX IF NOT EXISTS idx_pe_test_run_id ON parking_entries (test_run_id) WHERE test_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eh_test_run_id ON exit_history (test_run_id) WHERE test_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_al_test_run_id ON audit_logs (test_run_id) WHERE test_run_id IS NOT NULL;
