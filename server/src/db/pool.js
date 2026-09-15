// Single shared MySQL connection pool for the whole API.
//
// Configuration comes from the project-root .env so that the API, the ETL
// scripts and MySQL Workbench all describe the same database in one place.
// A server/.env, if present, takes precedence for deployment overrides.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(here, '..', '..');
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

dotenv.config({ path: path.join(SERVER_DIR, '.env') });
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'scoutlens',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  // Return DECIMAL columns as JS numbers rather than strings so the
  // client can chart them without parsing every field.
  decimalNumbers: true,
});

/** Runs a parameterised query and returns the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Calls a stored procedure. mysql2 returns one result set per SELECT in
 * the routine plus a trailing status packet, so the first set is unwrapped.
 */
export async function callProc(name, params = []) {
  const placeholders = params.map(() => '?').join(', ');
  const [sets] = await pool.query(`CALL ${name}(${placeholders})`, params);
  return Array.isArray(sets[0]) ? sets[0] : [];
}
