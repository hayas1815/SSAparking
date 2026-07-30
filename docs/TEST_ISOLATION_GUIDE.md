# Test Isolation Guide

## Overview

All automated tests in this project are **strictly isolated** from the production database. This guide explains how to set up a test database and how the safety mechanisms work.

## Safety Guards

The system has **three layers** of protection against tests touching production data:

### 1. Environment Variable Guard
- `NODE_ENV=test` must be set when running tests
- `TEST_DATABASE_URL` must be configured and non-empty
- `TEST_DATABASE_URL` must differ from `DATABASE_URL`
- If any check fails, the test process exits immediately with code 1

### 2. Test Run ID Tagging
- Each test run generates a unique ID: `trun_<timestamp>_<random>`
- All test records are tagged with this ID in the `test_run_id` column
- Cleanup only deletes records matching the test run ID
- Production data (where `test_run_id IS NULL`) is never touched

### 3. Connection Routing
- `db.js` reads `NODE_ENV` — when set to `test`, it uses `TEST_DATABASE_URL`
- `config/env.js` calls `assertSafeTestDatabase()` during env validation for test mode
- The test helper creates its own `pg.Pool` directly against `TEST_DATABASE_URL`

## Setting Up a Neon Test Branch

### Option A: Neon Branch (Recommended)

1. Open the [Neon Console](https://console.neon.tech)
2. Select your project
3. Go to **Branches** → **Create Branch**
4. Name it `test` (or `testing`)
5. Select **From parent** → your main branch
6. Copy the connection string for the new branch

### Option B: Separate Neon Project

1. Create a new Neon project (e.g., `ssatwowheeler-test`)
2. Copy its connection string
3. The schema will be auto-migrated on first test run

### Configure Environment

Add to your `.env` file:

```env
TEST_DATABASE_URL=postgres://user:password@ep-test-branch-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

> **CRITICAL**: Verify `TEST_DATABASE_URL` is different from `DATABASE_URL`!

## Running Tests

```bash
# Run all tests (unit + integration + security)
npm test

# Run only unit tests (no DB required)
node --test tests/unit/

# Run with verbose output
node --test --test-reporter=spec tests/unit/ tests/integration/ tests/security/
```

### Test Without a Test Database

Unit and security tests run without any database connection. Integration tests that require a database will **skip gracefully** with a warning message when `TEST_DATABASE_URL` is not set.

```
⚠️  Skipping DB integration tests: TEST_DATABASE_URL not configured
```

## Test Structure

```
tests/
├── helpers/
│   ├── testDb.js         — Safety guards, test pool, cleanup
│   ├── testSetup.js      — Bootstrap, JWT, migration runner
│   └── mockStorage.js    — Mock backup storage driver
├── unit/
│   ├── validation.test.js — Payment validation, CSV injection
│   ├── export.test.js     — XLSX/PDF signature verification
│   └── env.test.js        — Environment safety guards
├── integration/
│   ├── parking.test.js    — Entry, checkout, duplicates, rollback
│   ├── auth.test.js       — Login, roles, deactivated users
│   ├── backup.test.js     — Mock storage, path traversal
│   └── cron.test.js       — CRON_SECRET, advisory locks
└── security/
    └── safety.test.js     — Path traversal, injection, DB guards
```

## What Tests Never Do

- ❌ Connect to `DATABASE_URL` (production)
- ❌ Reset or modify `parking_token_seq` on production
- ❌ Delete production data
- ❌ Run restore operations against production
- ❌ Execute cleanup jobs against production
