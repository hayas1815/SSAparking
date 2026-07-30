# Data Lifecycle Model

## Overview

The SSA Two-Wheeler Parking System uses a **dual-table lifecycle model** for vehicle parking records:

| Table | Purpose | Mutability |
|-------|---------|------------|
| `parking_entries` | **Active operational table** — holds currently parked vehicles | Mutable (status updates, soft delete) |
| `exit_history` | **Immutable checkout archive** — permanent record of all completed exits | Append-only (insert on checkout) |

## Lifecycle Flow

```
Vehicle Entry → parking_entries (status='ACTIVE', deleted_at=NULL)
                         │
                    Checkout
                         │
                         ├── INSERT → exit_history (permanent archive)
                         │
                         └── UPDATE → parking_entries (status='EXITED', deleted_at=NOW())
```

### On Vehicle Entry

1. A new row is inserted into `parking_entries` with `status = 'ACTIVE'` and `deleted_at = NULL`
2. A token number is allocated from `parking_token_seq`
3. An audit log entry is created

### On Vehicle Checkout

1. The active entry is locked with `SELECT ... FOR UPDATE` to prevent concurrent checkout
2. The parking fee is calculated server-side based on entry time
3. A new row is **inserted** into `exit_history` (immutable archive)
4. The `parking_entries` row is soft-deleted: `status = 'EXITED'`, `deleted_at = NOW()`
5. An audit log entry is created

### Why Both Tables?

- **`parking_entries` EXITED rows** serve as a soft-delete audit trail with the original entry data
- **`exit_history`** is the canonical revenue/reporting archive with both entry and exit data
- Revenue reports query only `exit_history` — no double-counting

## Query Rules

### Active Vehicle Queries

All queries for currently parked vehicles MUST use:

```sql
WHERE (status = 'ACTIVE' OR status IS NULL) AND deleted_at IS NULL
```

The `OR status IS NULL` handles legacy rows from before the `status` column existed.

### Duplicate Vehicle Check

Prevents the same vehicle number from being parked twice simultaneously:

```sql
SELECT id FROM parking_entries 
WHERE UPPER(veh_no) = $1 
  AND (status = 'ACTIVE' OR status IS NULL) 
  AND deleted_at IS NULL
```

This correctly ignores exited/soft-deleted records.

### Revenue Reports

Always query `exit_history`:

```sql
SELECT SUM(total_amount) FROM exit_history WHERE ...
```

Never sum from `parking_entries` to avoid double-counting.

## Token Sequence Strategy

**Strategy: Globally Increasing Sequential**

- Sequence: `parking_token_seq` (PostgreSQL `SEQUENCE`)
- Start value: `500`
- Increment: `1`
- No daily reset, no outlet-specific sequences
- Tokens are unique across the entire system lifetime

### Recalibration

If the sequence drifts (e.g., from past test contamination), it can be recalibrated:

```sql
SELECT setval('parking_token_seq', 
  GREATEST(500, COALESCE((SELECT MAX(token_no) FROM parking_entries WHERE token_no < 900000), 499)), 
  true
);
```

Token numbers ≥ 900000 are reserved for test data.

## Cleanup and Retention

- Exit history older than `HISTORY_RETENTION_DAYS` (default: 45) is purged by the cleanup job
- Audit logs older than 90 days are purged by the audit cleanup job
- Soft-deleted `parking_entries` rows (status='EXITED') are retained for audit purposes
- Cleanup jobs use PostgreSQL advisory locks to prevent concurrent execution
