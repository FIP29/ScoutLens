// ---------------------------------------------------------------------
// ScoutLens API - Express + MySQL.
//
// The server is deliberately thin: it validates input, turns filter
// selections into parameterised SQL, and hands the work to MySQL views
// and stored procedures. No statistics are recomputed in JavaScript.
// ---------------------------------------------------------------------

// pool.js loads the project-root .env before anything reads process.env.
import { pool } from './db/pool.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { metaRouter } from './routes/meta.js';
import { playersRouter } from './routes/players.js';
import { analyticsRouter } from './routes/analytics.js';
import { scoutingRouter } from './routes/scouting.js';
import { peersRouter } from './routes/peers.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '256kb' }));
// The admin session lives in an httpOnly cookie; parse it for the admin routes.
app.use(cookieParser());

// Liveness plus a quick database round trip, so `curl /api/health` tells
// you whether the API is up *and* whether MySQL is reachable.
app.get('/api/health', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS player_seasons FROM player_seasons');
    res.json({ status: 'ok', database: 'connected', ...rows[0] });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable', error: err.message });
  }
});

// Admin first: every route under /api/admin except login, logout and the
// session probe is guarded by requireAdmin (see routes/admin.js).
app.use('/api/admin', adminRouter);
app.use('/api/meta', metaRouter);
app.use('/api/players', playersRouter);
app.use('/api/peers', peersRouter);
app.use('/api', analyticsRouter);
app.use('/api', scoutingRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// MySQL errors that mean "the database does not have the shape this build
// of the app expects" - almost always a pulled update whose migration has
// not been run yet. Reporting these as a generic 500 sends people hunting
// for a bug in the wrong place, so they get their own message.
const SCHEMA_MISMATCH = new Set([
  'ER_BAD_FIELD_ERROR',   // unknown column
  'ER_NO_SUCH_TABLE',     // missing table
  'ER_SP_DOES_NOT_EXIST', // missing stored procedure or function
  'ER_VIEW_INVALID',      // a view referencing something that is gone
]);

// Central error handler. Known ApiErrors surface their message; anything
// else is logged in full and reported generically.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (SCHEMA_MISMATCH.has(err.code)) {
    console.error('[api] schema mismatch:', err.sqlMessage ?? err.message);
    return res.status(503).json({
      error: 'The database is out of date for this version of the app. '
           + 'Run "npm run db:migrate" in the project folder, then reload this page.',
      detail: err.sqlMessage ?? err.message,
    });
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`ScoutLens API listening on http://localhost:${PORT}`);
});

// Let nodemon/--watch restarts and container stops close MySQL cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
