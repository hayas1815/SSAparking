# SSA Two-Wheeler Parking — Troubleshooting Guide

## Common Issues

### 1. Server Won't Start — "ENVIRONMENT CONFIGURATION ERROR"
**Cause**: Missing or invalid `.env` variables.
**Fix**: Check `.env` file. Ensure:
- `DATABASE_URL` is set and correct
- `JWT_SECRET` is at least 64 characters long
- `BCRYPT_ROUNDS` is >= 12

### 2. Cannot GET /health — 404
**Cause**: The `/health` route is not registered after static file middleware.
**Fix**: Ensure `app.use('/health', healthRoutes)` is placed **after** `app.use(express.static(...))` in `server.js`.

### 3. Login Returns 500 — "connect ETIMEDOUT"
**Cause**: `DATABASE_URL` in `.env` has incorrect credentials.
**Fix**: Copy the exact connection string from **Neon Dashboard → Connection Details → Connection string**.

### 4. "Vehicle already parked" on Entry
**Cause**: The vehicle number already has an active entry in `parking_entries`.
**Fix**: Either check out the active vehicle first, or verify the correct vehicle number was entered.

### 5. Duplicate Token Error on Entry
**Cause**: The manually entered token number conflicts with an existing entry.
**Fix**: Use the **Get Next Token** button to auto-generate a unique token from the PostgreSQL sequence.

### 6. Checkout Returns 404 — "Vehicle already exited"
**Cause**: The token/barcode has already been processed (soft deleted).
**Fix**: Verify the token number in Exit History. If it appears there, the vehicle has already been checked out.

### 7. History Shows Wrong Totals
**Cause**: Old JavaScript-calculated totals (pre-Phase 2).
**Fix**: Totals are now computed via PostgreSQL `SUM()`. Reload the page to see updated figures.

### 8. CORS Error in Browser
**Cause**: `ALLOWED_ORIGIN` does not match the frontend domain.
**Fix**: Set `ALLOWED_ORIGIN=https://your-domain.vercel.app` in Vercel environment variables.

### 9. pg-mem or pg_mem Module Error
**Cause**: Old cached `node_modules` with `pg-mem`.
**Fix**: Run `npm install` after pulling latest code (pg-mem was removed in Phase 1.1).

### 10. Audit Logs Not Recording
**Cause**: `audit_logs` table missing `role` or `user_agent` column.
**Fix**: Restart the server — `db.js` automatically runs `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ...` on startup.
