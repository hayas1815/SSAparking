-- Migration 002: Token Sequence Cleanup & Calibration
-- Root cause: Previous un-isolated test runs inserted hardcoded test tokens (e.g. 999992-999994),
-- causing parking_token_seq to be bumped to 999994.
-- Fix: Remove orphan test token entries (>= 900000) and safely recalibrate parking_token_seq.

DELETE FROM parking_entries WHERE token_no >= 900000 OR veh_no LIKE 'TN%TEST%' OR veh_no = 'TN01DUPTEST';
DELETE FROM exit_history WHERE token_no >= 900000 OR veh_no LIKE 'TN%TEST%' OR veh_no = 'TN01DUPTEST';

SELECT setval('parking_token_seq', GREATEST(500, COALESCE((SELECT MAX(token_no) FROM parking_entries WHERE token_no < 900000), 499)), true);
