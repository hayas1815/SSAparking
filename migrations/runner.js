const fs = require('fs');
const path = require('path');

/**
 * Idempotent Database Migration Runner
 * Executes unapplied .sql migrations in numerical order and records them in `schema_migrations`.
 * @param {object} pool - PostgreSQL pool connection
 */
async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create schema_migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get applied migrations
    const appliedRes = await client.query(`SELECT filename FROM schema_migrations`);
    const appliedSet = new Set(appliedRes.rows.map(r => r.filename));

    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (!appliedSet.has(file)) {
        const sqlPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log(`[MIGRATION] Applying ${file}...`);
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
        appliedCount++;
      }
    }

    await client.query('COMMIT');
    if (appliedCount > 0) {
      console.log(`✅ Applied ${appliedCount} new database migrations.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
