# SSA Two-Wheeler Parking — API Documentation

Base URL: `http://localhost:5500` (dev) / `https://your-app.vercel.app` (prod)

All protected endpoints require: `Authorization: Bearer <JWT_TOKEN>`

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | - | PostgreSQL connection URI (Neon PostgreSQL) |
| `JWT_SECRET` | Yes | - | Secret key for signing JWTs (min 64 chars) |
| `PORT` | No | `5500` | HTTP port |
| `BCRYPT_ROUNDS` | No | `12` | Cost factor for bcrypt password hashing (min 12) |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`) |
| `ALLOWED_ORIGIN` | Yes | `*` | Allowed CORS origins |
| `HISTORY_RETENTION_DAYS` | No | `45` | Auto-cleanup threshold for exit history (days) |
| `OUTLET_TIMEZONE` | No | `Asia/Kolkata` | Timezone for reports, dates, and timestamps |
| `BACKUP_STORAGE_DRIVER` | No | `local` | Backup driver (`local` for dev, `s3`/`gcs`/`provider-managed` for prod) |

---

## Authentication

### POST /api/login
Login and receive a JWT token.
```json
Request: { "username": "admin", "password": "password" }
Response 200: { "success": true, "token": "eyJ...", "user": { "id": 1, "username": "admin", "role": "owner" } }
Response 401: { "success": false, "message": "Invalid Username or Password", "errorCode": "UNAUTHORIZED" }
Response 403: { "success": false, "message": "Account has been deactivated.", "errorCode": "ACCOUNT_DEACTIVATED" }
Response 429: { "success": false, "message": "Too many login attempts" }
```

### POST /api/logout *(requires auth)*
Logout and log audit event.
```json
Response 200: { "success": true, "message": "Logged out successfully!" }
```

### GET /api/me *(requires auth)*
Get current authenticated user information.
```json
Response 200: { "success": true, "user": { "id": 1, "username": "admin", "role": "owner", "fullName": "Admin User" } }
```

---

## Setup

### GET /api/setup/status
Check if initial owner setup is required.
```json
Response 200: { "success": true, "isSetupRequired": true, "userCount": 0 }
```

### POST /api/setup
Create initial owner account (only if no users exist).
```json
Request: { "username": "owner", "password": "secure_pass", "fullName": "Owner Name", "phone": "9876543210" }
Response 201: { "success": true, "message": "Owner account created successfully!" }
```

---

## Parking Operations *(all require auth)*

### GET /api/parking/next-token
Get next available parking token (sequence-based).
```json
Response 200: { "success": true, "nextToken": 512 }
```

### GET /api/parking/entries
Get all active parking entries. Supports `?search=`, `?barcode=`, `?tokenNo=`.
```json
Response 200: { "success": true, "count": 5, "entries": [...] }
```

### POST /api/parking/entry
Save a new vehicle parking entry.
```json
Request: { "tokenNo": 512, "barcode": "CARD-512", "vehType": "BIKE 15", "vehNo": "TN01AB1234", "custName": "Name", "mobileNo": "9876543210", "rate": 15, "paymentMode": "CASH" }
Response 201: { "success": true, "message": "Token #512 saved...", "tokenNo": 512, "barcode": "CARD-512" }
Response 409: { "success": false, "errorCode": "DUPLICATE_ENTRY", "message": "Vehicle already parked." }
```

### GET /api/parking/lookup?query=TN01AB1234
Lookup active vehicle by vehicle number, barcode, or token.
```json
Response 200: { "success": true, "entry": { "token_no": 512, "veh_no": "TN01AB1234", "rate": 15 } }
Response 404: { "success": false, "message": "No active vehicle found matching [TN01AB1234]" }
```

### POST /api/parking/checkout
Complete vehicle exit checkout (server calculates final fee).
```json
Request: { "tokenNo": 512, "paymentMode": "GPAY", "fineAmount": 0 }
Response 200: { "success": true, "message": "Vehicle Token #512 exit completed!", "totalAmount": 30 }
Response 404: { "success": false, "errorCode": "VEHICLE_ALREADY_EXITED" }
```

### GET /api/parking/history *(owner, manager)*
Get paginated exit history with SQL aggregations. Max limit: 100.
```
?page=1&limit=50&search=TN01&vehNo=TN&mobileNo=9876&paymentMode=GPAY&dateFrom=2026-01-01&dateTo=2026-12-31
```
```json
Response 200: {
  "success": true, "count": 50,
  "summary": { "totalAmount": 1500, "cashAmount": 900, "gpayAmount": 600 },
  "history": [...],
  "pagination": { "currentPage": 1, "pageSize": 50, "totalRecords": 125, "totalPages": 3 }
}
```

### DELETE /api/parking/entries *(owner only)*
Soft-delete all active parking entries (sets status=EXITED, deleted_at=NOW).
```json
Response 200: { "success": true, "message": "All active parking entries cleared." }
```

### GET /api/parking/dashboard *(owner, manager)*
Get dashboard statistics from SQL views and PL/pgSQL functions using `OUTLET_TIMEZONE`.
```json
Response 200: {
  "success": true,
  "activeVehicles": 12,
  "today": { "vehicleCount": 45, "totalRevenue": 1350, "cashRevenue": 900, "gpayRevenue": 450, "totalFine": 0 },
  "monthlyCollection": [...],
  "peakHours": [...]
}
```

### GET /api/parking/search *(all authenticated)*
Advanced multi-field search with pagination and vehicle number space-normalization. Max limit: 100.
```
?vehNo=TN01&mobileNo=9876&tokenNo=512&custName=Ravi&paymentMode=CASH&status=history&page=1&limit=25
```

### GET /api/parking/export *(owner, manager)*
Download report exports with OWASP formula injection protection. Max limit: 5000 rows.
```
?format=csv&type=history&dateFrom=2026-01-01&dateTo=2026-07-30
?format=excel&type=daily
?format=pdf&type=active
?format=csv&type=monthly
```

### GET /api/parking/audit-logs *(owner, manager)*
Get paginated audit log records. Max limit: 100.
```
?page=1&limit=50&search=LOGIN
```

### POST /api/parking/jobs/trigger *(owner only)*
Manually trigger background maintenance job (`history-cleanup` or `audit-cleanup`). Supports `dryRun: true`.
```json
Request: { "job": "history-cleanup", "dryRun": true }
Response 200: { "success": true, "message": "Job 'history-cleanup' executed.", "result": { "affectedRows": 15, "dryRun": true } }
```

### Backup Management Endpoints *(owner only)*

- `POST /api/parking/backup` — Trigger instant logical JSON backup (prohibited in prod if `BACKUP_STORAGE_DRIVER=local`).
- `GET /api/parking/backups` — List available backup metadata (path stripped for security).
- `POST /api/parking/backup/verify` — Verify backup integrity (`{ "filename": "backup_2026-07-30.json" }`).
- `POST /api/parking/backup/restore` — Atomic database restore (`{ "filename": "backup_2026-07-30.json", "confirmText": "RESTORE_DATABASE_CONFIRM" }`). Pre-verifies backup before restoring.

### GET /api/admin/diagnostics *(owner only)*
Full server metrics, node memory, uptime, PostgreSQL version, pool stats, and table live/dead tuple stats.

---

## Health Probes

### GET /health *(public)*
Minimal privacy-preserving health probe (for load balancers / uptime monitors). Returns only status, database connectivity status, timestamp, and application version.
```json
Response 200: {
  "success": true,
  "server": "running",
  "database": "connected",
  "timestamp": "2026-07-30T19:00:00.000Z",
  "version": "1.0.0"
}
Response 503: {
  "success": false,
  "server": "running",
  "database": "disconnected",
  "timestamp": "2026-07-30T19:00:00.000Z",
  "version": "1.0.0"
}
```

### GET /health/ready *(public)*
Lightweight liveness probe for Kubernetes / Vercel container checks. Returns 200 OK immediately without DB call.

### GET /health/db *(public)*
Isolated database ping test with roundtrip latency in milliseconds.

---

## Error Format (All Errors)
```json
{
  "success": false,
  "message": "Human-readable error message",
  "errorCode": "UNAUTHORIZED | FORBIDDEN | NOT_FOUND | INVALID_INPUT | INTERNAL_SERVER_ERROR",
  "requestId": "uuid-v4-for-tracing",
  "timestamp": "2026-07-30T19:00:00.000Z"
}
```

## Standard Response Envelope
```json
{
  "success": true,
  "message": "...",
  "data": { ... },       // structured payload (new clients)
  ...data,               // spread at root (backward compat)
  "pagination": {        // only when paginated
    "currentPage": 1,
    "pageSize": 50,
    "totalRecords": 125,
    "totalPages": 3
  },
  "timestamp": "2026-07-30T19:00:00.000Z",
  "requestId": "uuid-v4"
}
```
