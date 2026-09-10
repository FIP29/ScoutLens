// Runs every .sql file in a directory, in filename order.
//   node etl/run-sql.js db/schema
//   node etl/run-sql.js db/logic
//
// Statements are split client-side (see sql-split.js) so the same files
// work here, in the mysql CLI and in MySQL Workbench.
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { dbConfig, ROOT } from './config.js';
import { splitStatements } from './sql-split.js';

const dir = path.resolve(ROOT, process.argv[2] || 'db/schema');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
if (!files.length) {
  console.error(`No .sql files in ${dir}`);
  process.exit(1);
}

// 01_schema.sql issues CREATE DATABASE, so connect without selecting one.
const { database, ...rest } = dbConfig;
const conn = await mysql.createConnection({ ...rest, multipleStatements: true });

let executed = 0;
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  const statements = splitStatements(sql);
  process.stdout.write(`  running ${file} (${statements.length} statements) ... `);
  for (const statement of statements) {
    try {
      await conn.query(statement);
      executed++;
    } catch (err) {
      console.log('failed');
      console.error(`\n${file}: ${err.message}\n--- statement ---\n${statement.slice(0, 400)}\n`);
      await conn.end();
      process.exit(1);
    }
  }
  console.log('ok');
}

await conn.end();
console.log(`Applied ${files.length} file(s), ${executed} statements, from ${path.relative(ROOT, dir)}.`);
