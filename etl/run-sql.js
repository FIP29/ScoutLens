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
      console.error(`\n${file}: ${err.message}`);

      // MySQL 8 enables binary logging by default and refuses to let a
      // non-SUPER user create stored functions or triggers. The message
      // MySQL returns does not say how to fix it, so spell it out.
      if (/SUPER privilege and binary logging/i.test(err.message)) {
        console.error(
          '\nFix: an administrator must allow non-SUPER users to create routines.\n' +
          '  sudo mysql -e "SET GLOBAL log_bin_trust_function_creators = 1;"\n' +
          '(use SET PERSIST instead of SET GLOBAL on MySQL 8 to survive a restart)\n' +
          'Then re-run this step. See README.md > Troubleshooting.');
      }

      console.error(`--- statement ---\n${statement.slice(0, 400)}\n`);
      await conn.end();
      process.exit(1);
    }
  }
  console.log('ok');
}

await conn.end();
console.log(`Applied ${files.length} file(s), ${executed} statements, from ${path.relative(ROOT, dir)}.`);
