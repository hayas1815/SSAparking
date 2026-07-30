# SSA Two-Wheeler Parking — Database ER Diagram

```mermaid
erDiagram
    users {
        SERIAL id PK
        VARCHAR username UK
        VARCHAR password
        VARCHAR full_name
        VARCHAR phone
        VARCHAR role
        TIMESTAMP created_at
    }

    parking_entries {
        SERIAL id PK
        INTEGER token_no UK
        VARCHAR barcode
        VARCHAR veh_type
        VARCHAR veh_no
        VARCHAR cust_name
        VARCHAR mobile_no
        NUMERIC rate
        VARCHAR payment_mode
        VARCHAR in_date
        VARCHAR entry_time
        VARCHAR status
        VARCHAR exit_time
        INTEGER total_hours
        NUMERIC total_amount
        INTEGER created_by FK
        TIMESTAMP deleted_at
        TIMESTAMP created_at
    }

    exit_history {
        SERIAL id PK
        INTEGER token_no
        VARCHAR barcode
        VARCHAR veh_type
        VARCHAR veh_no
        VARCHAR cust_name
        VARCHAR mobile_no
        NUMERIC rate
        VARCHAR payment_mode
        VARCHAR in_date
        VARCHAR entry_time
        VARCHAR exit_date
        VARCHAR exit_time
        NUMERIC fine_amount
        NUMERIC total_amount
        INTEGER created_by FK
        TIMESTAMP exited_at
    }

    audit_logs {
        SERIAL id PK
        INTEGER user_id FK
        VARCHAR username
        VARCHAR role
        VARCHAR action
        VARCHAR ip_address
        TEXT user_agent
        TEXT details
        TIMESTAMP created_at
    }

    users ||--o{ parking_entries : "created_by"
    users ||--o{ exit_history : "created_by"
    users ||--o{ audit_logs : "user_id"
```

## Table Descriptions

| Table | Purpose |
|-------|---------|
| `users` | System users with roles (owner, manager, cashier, security) |
| `parking_entries` | Active and soft-deleted vehicle parking records |
| `exit_history` | Archived records of vehicles that have exited |
| `audit_logs` | Security and operational audit trail |

## Sequence
| Sequence | Start | Purpose |
|----------|-------|---------|
| `parking_token_seq` | 500 | Race-condition safe token number generation |

## Views
| View | Description |
|------|-------------|
| `vw_dashboard` | Today's active vehicles and revenue |
| `vw_daily_collection` | Daily revenue grouped by exit_date |
| `vw_monthly_collection` | Monthly revenue aggregated by exited_at |
| `vw_vehicle_summary` | Vehicle type distribution and revenue |

## PL/pgSQL Functions
| Function | Returns | Description |
|----------|---------|-------------|
| `fn_get_daily_summary(p_date)` | TABLE | Today's vehicle count, revenue, cash, GPAY, fine totals |
