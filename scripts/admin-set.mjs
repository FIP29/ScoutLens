// ---------------------------------------------------------------------
// Creates the admin account, or replaces its email/password.
//
//   npm run admin:set
//
// Asks for an email and a password, hashes the password with bcrypt, and
// writes the single admin row. Running it again resets the credentials.
//
// The password is typed at a hidden prompt, never passed as a command-line
// argument, so it does not end up in shell history or in `ps` output.
//
// For scripted setups only, ADMIN_EMAIL and ADMIN_PASSWORD environment
// variables skip the prompts. Prefer the prompt: a password in the
// environment is visible to other processes run by the same user.
// ---------------------------------------------------------------------

import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { dbConfig } from '../etl/config.js';

const MIN_PASSWORD = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function askVisible(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

/** Reads a line without echoing it, handling backspace and Ctrl+C. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish();
        if (ch === '\u0003') {                      // Ctrl+C
          stdin.setRawMode(false);
          stdout.write('\nCancelled. Nothing was changed.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

async function main() {
  console.log('ScoutLens - set the admin account\n');

  const fromEnv = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
  if (!fromEnv && !process.stdin.isTTY) {
    fail('Run this in an interactive terminal, or set ADMIN_EMAIL and ADMIN_PASSWORD.');
  }

  const email = (fromEnv ? process.env.ADMIN_EMAIL : await askVisible('Admin email: '))
    .trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) fail('That does not look like an email address.');

  let password;
  if (fromEnv) {
    password = process.env.ADMIN_PASSWORD;
  } else {
    password = await askHidden(`Password (at least ${MIN_PASSWORD} characters, hidden): `);
    const confirm = await askHidden('Repeat the password: ');
    if (password !== confirm) fail('The passwords did not match. Nothing was changed.');
  }
  if (password.length < MIN_PASSWORD) fail(`The password must be at least ${MIN_PASSWORD} characters.`);
  if (password.length > 72) fail('The password must be at most 72 characters (a bcrypt limit).');

  const rounds = Math.min(Math.max(Number(process.env.BCRYPT_ROUNDS) || 12, 10), 15);
  process.stdout.write(`Hashing with bcrypt (cost ${rounds})... `);
  const hash = await bcrypt.hash(password, rounds);
  console.log('done');

  const conn = await mysql.createConnection(dbConfig);
  try {
    const [[table]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admins'`, [dbConfig.database]);
    if (!table.n) fail('The admins table does not exist yet. Run "npm run db:migrate" first.');

    // id is pinned to 1 by a CHECK constraint, so this either creates the
    // one admin or overwrites it - there is no way to end up with two.
    await conn.execute(
      `INSERT INTO admins (id, email, password_hash) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash)`,
      [email, hash]);
  } finally {
    await conn.end();
  }

  console.log(`\nAdmin account set for ${email}.`);
  console.log('Log in from the "Admin" link in the app.');
}

main().catch((err) => fail(`Could not set the admin account: ${err.message}`));
