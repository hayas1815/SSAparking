# SSA Two-Wheeler Parking — Deployment Guide

## Prerequisites

- Node.js >= 18 (v24+ recommended)
- Neon PostgreSQL account (https://neon.tech)
- Vercel account (https://vercel.com)

---

## 1. Local Development Setup

```bash
# Clone repository
git clone <your-repo-url>
cd ssatwowheeler-main

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your real Neon DATABASE_URL and JWT_SECRET

# Migrate existing users (SHA256 → bcrypt)
npm run migrate

# Start development server
npm start
# Server runs at http://localhost:5500
```

---

## 2. Required Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | ✅ | Full Neon PostgreSQL connection string (`sslmode=require`) |
| `JWT_SECRET` | ✅ | Minimum 64 characters long |
| `CRON_SECRET` | ✅ (production) | Secret for authenticating Vercel Cron requests (min 32 chars) |
| `TEST_DATABASE_URL` | ✅ (testing) | Separate Neon branch/DB for tests. See [Test Isolation Guide](TEST_ISOLATION_GUIDE.md) |
| `BCRYPT_ROUNDS` | Optional | Default `12` (minimum 12 enforced) |
| `NODE_ENV` | Optional | Set to `production` on Vercel |
| `ALLOWED_ORIGIN` | Optional | Allowed CORS origins (e.g. `https://your-domain.com`) |
| `PORT` | Optional | Default `5500` |
| `HISTORY_RETENTION_DAYS` | Optional | Retention period for history cleanup (default `45`) |
| `OUTLET_TIMEZONE` | Optional | Timezone for reports & timestamps (default `Asia/Kolkata`) |
| `BACKUP_STORAGE_DRIVER` | Optional | `local` (dev only), `provider-managed` (production). `s3`/`gcs` not yet implemented |

---

## 3. Vercel Deployment

1. Push code to GitHub (ensure `.env` is in `.gitignore`).
2. Connect GitHub repo to Vercel.
3. In **Vercel Dashboard → Settings → Environment Variables**, add all variables from the table above.
4. Deploy.

### Vercel Serverless Considerations & Scheduled Jobs
- **Background Scheduler (`setInterval`)**: Disabled automatically on Vercel because serverless functions are stateless and ephemeral.
- **Vercel Cron Jobs**: Configured in `vercel.json` — calls `POST /api/cron/run` daily at 2:00 AM UTC.
  - Authenticated via `CRON_SECRET` (set in Vercel environment variables).
  - Does NOT use JWT — uses `Authorization: Bearer <CRON_SECRET>` header.
  - Supported jobs: `history-cleanup`, `audit-cleanup`, `backup-retention-cleanup`.
  - Supports `dryRun` mode for safe testing.
- **External Cron Alternative**: Use [cron-job.org](https://cron-job.org) or GitHub Actions to call `POST /api/cron/run` with `Authorization: Bearer <CRON_SECRET>`.
- **Backups on Vercel**: Local file backups are disabled in production. Use Neon's built-in Point-in-Time Recovery (PITR).

### Export Capabilities

| Format | MIME Type | Genuine |
|--------|-----------|--------|
| CSV | `text/csv` | ✅ RFC-4180 compliant |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ✅ Real ExcelJS workbook |
| PDF | `application/pdf` | ✅ Real PDFKit document |
| Printable | `text/html` | ✅ Browser-printable HTML |

---

## 4. First-Time Setup

After deployment, visit `https://your-app.vercel.app` — the setup screen will appear automatically if no users exist.

1. Enter owner username, password, full name, and phone.
2. Submit to create the first Owner account.
3. Log in and start managing parking.

---

## 5. Health Check & Diagnostics

- **Public Uptime Probe**: `GET https://your-app.vercel.app/health`
  Returns minimal privacy-preserving status (`{ "success": true, "server": "running", "database": "connected" }`).
- **Liveness Probe**: `GET https://your-app.vercel.app/health/ready`
- **Database Ping**: `GET https://your-app.vercel.app/health/db`
- **Full System Diagnostics (Owner Only)**: `GET https://your-app.vercel.app/api/admin/diagnostics` (requires JWT token).
