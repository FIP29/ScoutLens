import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'scoutlens',
  charset: 'utf8mb4',
};

// The CSV that seeds the database. Override with CSV_PATH to load a
// refreshed scrape without touching the code.
export const CSV_PATH =
  process.env.CSV_PATH || path.join(ROOT, 'data', 'player_stats_2020_2026.csv');
