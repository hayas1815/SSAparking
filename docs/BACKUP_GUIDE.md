# SSA Two-Wheeler Parking — Backup & Disaster Recovery Guide

## Security & Production Backup Architecture

> [!CAUTION]
> **Vercel / Serverless Filesystem Limitation**: Vercel local filesystem storage is temporary and non-persistent. Local file backups stored in `/backups` are **FOR DEVELOPMENT USE ONLY**.
> 
> In production (`NODE_ENV=production`), creation and restoration of local filesystem backups is **prohibited by default**. Production environments must set `BACKUP_STORAGE_DRIVER` to a durable cloud storage mechanism (`s3`, `gcs`, or `provider-managed`).

---

## Production Backup Strategies

### 1. Neon Managed Point-in-Time Restore (Recommended for Production)
Neon PostgreSQL automatically manages point-in-time recovery (PITR) and database branching.

1. Log into your dashboard at [https://neon.tech](https://neon.tech).
2. Select your project → **Branches** or **Restore**.
3. Choose a restore timestamp or snapshot point.
4. Click **Restore**.

### 2. Manual pg_dump SQL Export
```bash
# Export full binary/plain SQL dump from Neon
pg_dump "postgres://user:pass@ep-host.neon.tech/dbname?sslmode=require" \
  --format=custom \
  --file=production_backup_$(date +%Y%m%d_%H%M%S).dump
```

### 3. API Logical Backup Endpoint (Development & Admin Staging)
Authenticated Owners can trigger a logical JSON backup via API:

```bash
POST /api/parking/backup
Authorization: Bearer <OWNER_JWT_TOKEN>
```

Backups are saved under `/backups/backup_YYYY-MM-DD_HH-mm-ss.json`.

---

## Secure Restoration Procedure

Restoration overrides live database table data with backup contents inside an atomic PostgreSQL transaction.

### Requirements:
1. **JWT Authentication**: Must be authenticated as an `owner` role.
2. **Pre-Verification**: The server automatically runs `verifyBackup()` on the target file before initiating restoration. Unverified or corrupted files are rejected.
3. **Explicit Confirmation**: Requires `{ "filename": "backup_name.json", "confirmText": "RESTORE_DATABASE_CONFIRM" }`.
4. **Environment Check**: Refused in production if `BACKUP_STORAGE_DRIVER=local`.

```bash
POST /api/parking/backup/restore
Authorization: Bearer <OWNER_JWT_TOKEN>
Content-Type: application/json

{
  "filename": "backup_2026-07-30_12-00-00.json",
  "confirmText": "RESTORE_DATABASE_CONFIRM"
}
```

---

## Security Safeguards
- **Path Traversal Protection**: Filenames are strictly validated using regex `^[a-zA-Z0-9_-]+\.json$`. Filenames containing `../`, `..\`, absolute paths, or invalid extensions are rejected with 400 Bad Request.
- **Credential Stripping**: Password hashes in `users` are automatically excluded from logical JSON backups.
- **Path Masking**: Internal server filesystem paths are stripped from API response payloads.
