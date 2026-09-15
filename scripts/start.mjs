// ---------------------------------------------------------------------
// Starts the API and the web client together.
//
//   npm start
//
// Running two long-lived dev servers normally means two terminals. This
// starts both in one, prefixes their output so you can tell them apart,
// and shuts both down cleanly on Ctrl+C.
//
// The servers are launched as direct `node` processes rather than through
// `npm run`. An `npm run` wrapper sits between this script and the real
// server, and killing the wrapper leaves the server orphaned with its
// port still bound - so Ctrl+C would look like it worked while quietly
// leaking both processes.
// ---------------------------------------------------------------------

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API_ENTRY = path.join(ROOT, 'server', 'src', 'index.js');
const VITE_BIN = path.join(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js');

for (const [file, hint] of [[API_ENTRY, 'server'], [VITE_BIN, 'client']]) {
  if (!fs.existsSync(file)) {
    console.error(
      `Missing ${path.relative(ROOT, file)}.\n` +
      `Run "npm run install:all" first - the ${hint} dependencies are not installed.`);
    process.exit(1);
  }
}

const SERVICES = [
  { name: 'api', colour: '\x1b[36m', script: API_ENTRY, cwd: path.join(ROOT, 'server') },
  { name: 'web', colour: '\x1b[35m', script: VITE_BIN, cwd: path.join(ROOT, 'client') },
];

const RESET = '\x1b[0m';
const children = [];
let shuttingDown = false;

const label = (service, line) => `${service.colour}[${service.name}]${RESET} ${line}`;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }

  // Give each server a moment to close its listener, then force the issue
  // so a wedged process can never hold the port after Ctrl+C.
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 600).unref();
}

for (const service of SERVICES) {
  const child = spawn(process.execPath, [service.script], {
    cwd: service.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  for (const stream of ['stdout', 'stderr']) {
    child[stream].setEncoding('utf8');
    child[stream].on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) console.log(label(service, line));
      }
    });
  }

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(label(service, `exited with code ${code}`));
    shutdown(code ?? 1);
  });

  child.on('error', (err) => {
    console.error(label(service, `failed to start: ${err.message}`));
    shutdown(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nStopping both servers...');
    shutdown(0);
  });
}

console.log('Starting ScoutLens - API on :4000, web app on :5173');
console.log('Open http://localhost:5173 once the [web] line appears. Ctrl+C stops both.\n');
