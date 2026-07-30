// PostgreSQL Database Setup for Two-Wheeler Parking System (Neon Database Only)
const env = require('./config/env');
const { Pool } = require('pg');
const { runMigrations } = require('./migrations/runner');

let pool;

function getDatabaseUrl() {
  if (env.NODE_ENV === 'test') {
    env.assertSafeTestDatabase();
    return env.TEST_DATABASE_URL;
  }
  return env.DATABASE_URL;
}

async function createPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing. Please set DATABASE_URL in .env.');
  }

  const poolConfig = {
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
  };

  const realPool = new Pool(poolConfig);
  realPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool client error:', err.message);
  });

  try {
    const client = await realPool.connect();
    client.release();
    const dbType = env.NODE_ENV === 'test' ? 'TEST' : 'PRODUCTION/DEV';
    console.log(`✅ Connected to Neon PostgreSQL Database (${dbType}).`);
    return realPool;
  } catch (err) {
    realPool.end().catch(() => {});
    console.error('❌ Database connection failed:', err.message);
    throw err;
  }
}

async function initDatabase() {
  try {
    if (!pool) pool = await createPool();

    // Run versioned migrations (schema_migrations, core tables, sequences, FKs, indexes)
    await runMigrations(pool);

    // ─── SQL Views ────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE VIEW vw_dashboard AS
      SELECT
        COUNT(CASE WHEN status = 'ACTIVE' AND deleted_at IS NULL THEN 1 END)    AS active_vehicles,
        COUNT(*)                                                                  AS total_entries_today,
        COALESCE(SUM(CASE WHEN status = 'EXITED' THEN total_amount ELSE 0 END), 0) AS exited_revenue
      FROM parking_entries
      WHERE created_at >= CURRENT_DATE;
    `);

    await pool.query(`DROP VIEW IF EXISTS vw_daily_collection;`);
    await pool.query(`
      CREATE OR REPLACE VIEW vw_daily_collection AS
      SELECT
        exit_date                                                       AS collection_date,
        COUNT(*)                                                        AS vehicle_count,
        COALESCE(SUM(total_amount), 0)                                  AS total_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'GPAY' THEN total_amount ELSE 0 END), 0) AS gpay_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'UPI'  THEN total_amount ELSE 0 END), 0) AS upi_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CARD' THEN total_amount ELSE 0 END), 0) AS card_revenue,
        COALESCE(SUM(fine_amount), 0)                                   AS total_fine
      FROM exit_history
      GROUP BY exit_date
      ORDER BY exit_date DESC;
    `);

    await pool.query(`DROP VIEW IF EXISTS vw_monthly_collection;`);
    await pool.query(`
      CREATE OR REPLACE VIEW vw_monthly_collection AS
      SELECT
        TO_CHAR(exited_at, 'YYYY-MM')                                  AS month,
        COUNT(*)                                                        AS vehicle_count,
        COALESCE(SUM(total_amount), 0)                                  AS total_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'GPAY' THEN total_amount ELSE 0 END), 0) AS gpay_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'UPI'  THEN total_amount ELSE 0 END), 0) AS upi_revenue,
        COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CARD' THEN total_amount ELSE 0 END), 0) AS card_revenue
      FROM exit_history
      GROUP BY TO_CHAR(exited_at, 'YYYY-MM')
      ORDER BY month DESC;
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW vw_vehicle_summary AS
      SELECT
        veh_type,
        COUNT(*)                            AS vehicle_count,
        COALESCE(SUM(total_amount), 0)      AS total_revenue,
        COALESCE(AVG(total_amount), 0)      AS avg_revenue
      FROM exit_history
      GROUP BY veh_type
      ORDER BY vehicle_count DESC;
    `);

    // ─── PL/pgSQL Functions ───────────────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION fn_get_daily_summary(p_date DATE DEFAULT CURRENT_DATE)
      RETURNS TABLE(vehicle_count BIGINT, total_revenue NUMERIC, cash_revenue NUMERIC, gpay_revenue NUMERIC, upi_revenue NUMERIC, card_revenue NUMERIC, total_fine NUMERIC) AS $$
      BEGIN
        RETURN QUERY
          SELECT
            COUNT(*)::BIGINT,
            COALESCE(SUM(total_amount), 0),
            COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CASH' THEN total_amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'GPAY' THEN total_amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'UPI'  THEN total_amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN UPPER(payment_mode) = 'CARD' THEN total_amount ELSE 0 END), 0),
            COALESCE(SUM(fine_amount), 0)
          FROM exit_history
          WHERE exited_at::date = COALESCE(p_date, CURRENT_DATE)
             OR exit_date = TO_CHAR(COALESCE(p_date, CURRENT_DATE), 'DD/MM/YYYY');
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // Fix null exited_at timestamps
    await pool.query(`UPDATE exit_history SET exited_at = CURRENT_TIMESTAMP WHERE exited_at IS NULL;`);

    console.log('✅ PostgreSQL schema verified successfully.');
  } catch (err) {
    console.error('Error initializing database schema:', err.message || err);
    throw err;
  }
}

let initPromise = null;

async function ensureInitialized() {
  if (!pool) pool = await createPool();
  if (!initPromise) {
    initPromise = initDatabase().catch(err => {
      initPromise = null;
      pool = null;
      throw err;
    });
  }
  await initPromise;
}

/**
 * Execute callback inside an atomic PostgreSQL transaction.
 */
async function transaction(callback) {
  await ensureInitialized();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the database connection pool.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    initPromise = null;
    console.log('PostgreSQL connection pool closed gracefully.');
  }
}

module.exports = {
  get pool() { return pool; },
  query: async (text, params) => {
    await ensureInitialized();
    return pool.query(text, params);
  },
  transaction,
  closePool
};
