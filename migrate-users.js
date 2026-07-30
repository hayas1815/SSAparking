#!/usr/bin/env node
/**
 * One-Time Migration Script: Migrate SHA256-hashed users to bcrypt + plain usernames
 *
 * USAGE:
 *   Interactive mode:    node migrate-users.js
 *   Non-interactive:     node migrate-users.js --username ssaparking --password NewPassword123
 *
 * This script:
 * 1. Detects users with SHA256-hashed usernames (64 hex chars)
 * 2. Updates them with plain text username + bcrypt hashed password
 */
require('dotenv').config();
const readline = require('readline');
const db = require('./db');
const { hashPassword } = require('./utils/password');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const cliUsername = getArg('--username');
const cliPassword = getArg('--password');
const nonInteractive = !!(cliUsername && cliPassword);

const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => nonInteractive ? Promise.resolve('') : new Promise(resolve => rl.question(q, resolve));

async function migrate() {
  console.log('\n🔐 SSA Parking - User Migration: SHA256 → bcrypt\n');

  try {
    const result = await db.query(`SELECT id, username, full_name, phone, role FROM users`);
    const users = result.rows;

    if (users.length === 0) {
      console.log('✅ No users found. Use the setup screen at /api/setup/status to create the first owner.\n');
      if (rl) rl.close();
      process.exit(0);
    }

    console.log(`Found ${users.length} user(s):\n`);
    users.forEach((u, i) => {
      const isHashed = u.username && u.username.length === 64 && /^[a-f0-9]+$/.test(u.username);
      console.log(`  ${i + 1}. ID: ${u.id} | Username: ${isHashed ? '[SHA256 hashed]' : u.username} | Role: ${u.role} | Name: ${u.full_name}`);
    });

    if (nonInteractive) {
      // Non-interactive: apply provided credentials to first/all SHA256-hashed users
      console.log(`\n[Non-Interactive Mode] Migrating with username: "${cliUsername}"\n`);
      let migrated = 0;
      for (const user of users) {
        const isHashed = user.username && user.username.length === 64 && /^[a-f0-9]+$/.test(user.username);
        // Migrate SHA256 users; also migrate plain-text users if only one user exists
        if (isHashed || users.length === 1) {
          const hashedPassword = await hashPassword(cliPassword);
          await db.query(
            `UPDATE users SET username = $1, password = $2 WHERE id = $3`,
            [cliUsername.toLowerCase().trim(), hashedPassword, user.id]
          );
          console.log(`  ✅ Migrated ID ${user.id} (${user.full_name}) → username: "${cliUsername}"`);
          migrated++;
        }
      }
      console.log(`\n✅ Migration complete! ${migrated} user(s) migrated to bcrypt.\n`);
    } else {
      // Interactive mode
      console.log('\n⚠️  Enter new plain-text credentials for each user below.\n');
      for (const user of users) {
        const isHashed = user.username && user.username.length === 64 && /^[a-f0-9]+$/.test(user.username);
        const displayName = user.full_name || `User ID ${user.id}`;
        console.log(`─── Migrating: ${displayName} (Role: ${user.role}) ───`);

        const plainUsername = (await ask(`  Plain text username: `)).trim().toLowerCase();
        if (!plainUsername) { console.log('  ⚠️  Skipped\n'); continue; }

        const plainPassword = await ask(`  New password (min 6 chars): `);
        if (!plainPassword || plainPassword.length < 6) { console.log('  ⚠️  Skipped (password too short)\n'); continue; }

        const hashedPassword = await hashPassword(plainPassword);
        await db.query(
          `UPDATE users SET username = $1, password = $2 WHERE id = $3`,
          [plainUsername, hashedPassword, user.id]
        );
        console.log(`  ✅ Migrated → username: "${plainUsername}"\n`);
      }
      console.log('✅ Migration complete!\n');
    }
  } catch (err) {
    console.error('❌ Migration error:', err.message || err);
    process.exit(1);
  } finally {
    if (rl) rl.close();
    process.exit(0);
  }
}

migrate();
