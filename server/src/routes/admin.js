// ---------------------------------------------------------------------
// Admin: login and player create / update / delete.
//
// Public endpoints elsewhere in the API are untouched. Here, only login,
// logout and the session probe are open; everything registered after
// `adminRouter.use(requireAdmin)` needs a valid admin session cookie.
//
// Writes that span several tables run in a single transaction, so a
// failure part-way through can never leave, say, a player with no season
// or a season with stats that disagree with its minutes.
// ---------------------------------------------------------------------

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, ApiError, requiredInt } from '../lib/http.js';
import {
  authConfig, issueSession, clearSession, requireAdmin,
  COOKIE_NAME, NOT_CONFIGURED_MESSAGE,
} from '../lib/auth.js';

export const adminRouter = Router();

// ------------------------------------------------------------ login ---

// Five failed attempts per 15 minutes, then the door stays shut until the
// window passes. Successful logins do not count against the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS ?? 5),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Try again in 15 minutes.' },
});

// When the email does not match, a bcrypt comparison still runs against
// this throwaway hash, so a wrong email and a wrong password take the same
// time. Otherwise response timing would reveal whether an email is the
// admin's.
let dummyHash = null;
async function equaliseTiming(password, rounds) {
  dummyHash ??= await bcrypt.hash('scoutlens-timing-equaliser', rounds);
  await bcrypt.compare(password, dummyHash);
}

adminRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const config = authConfig();
  if (!config) return res.status(503).json({ error: NOT_CONFIGURED_MESSAGE });

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw new ApiError(400, 'Email and password are required.');
  // bcrypt only reads the first 72 bytes; refusing huge input up front
  // also stops anyone making the server hash megabytes of text.
  if (email.length > 254 || password.length > 200) {
    throw new ApiError(400, 'Email or password is too long.');
  }

  const [admin] = await query(
    'SELECT id, email, password_hash FROM admins WHERE email = ?', [email]);

  if (!admin) {
    await equaliseTiming(password, config.bcryptRounds);
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (!(await bcrypt.compare(password, admin.password_hash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const expiresAt = issueSession(res, admin, config);
  res.json({ email: admin.email, expires_at: expiresAt.toISOString() });
}));

adminRouter.post('/logout', (_req, res) => {
  clearSession(res, authConfig());
  res.status(204).end();
});

// Lets the UI decide between the login form and the admin tools without
// provoking a 401 on every visit - an anonymous visitor is not an error.
adminRouter.get('/session', (req, res) => {
  const config = authConfig();
  if (!config) return res.json({ authenticated: false, configured: false });

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.json({ authenticated: false, configured: true });
  try {
    const claims = jwt.verify(token, config.secret, {
      algorithms: ['HS256'], issuer: 'scoutlens', audience: 'scoutlens-admin',
    });
    return res.json({
      authenticated: true,
      configured: true,
      email: claims.email,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    });
  } catch {
    return res.json({ authenticated: false, configured: true });
  }
});

// ------------------------------------ everything below needs a login ---

adminRouter.use(requireAdmin);

// ------------------------------------------------------ validation ---

function text(value, field, max, { required = true } = {}) {
  const s = String(value ?? '').trim();
  if (!s) {
    if (required) throw new ApiError(400, `${field} is required.`);
    return null;
  }
  if (s.length > max) throw new ApiError(400, `${field} must be at most ${max} characters.`);
  return s;
}

/** Integer within [min, max]; null when optional and absent. */
function int(value, field, min, max, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, `${field} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

const STAT_FIELDS = {
  matches_played: [0, 80],
  starts: [0, 80],
  minutes: [0, 7200],
  goals: [0, 120],
  assists: [0, 120],
  pens_made: [0, 60],
  cards_yellow: [0, 40],
  cards_red: [0, 10],
};

/**
 * Validates the editable standard stats and derives everything that is a
 * function of them. The per-90 figures and totals are stored columns, so
 * the server recomputes them on every write rather than trusting the
 * client - otherwise goals and goals_per90 could quietly disagree.
 */
function buildStandardStats(input, existing = {}) {
  const merged = {};
  for (const [field, [min, max]] of Object.entries(STAT_FIELDS)) {
    const incoming = int(input?.[field], field, min, max);
    merged[field] = incoming ?? existing[field] ?? 0;
  }

  if (merged.starts > merged.matches_played) {
    throw new ApiError(400, 'starts cannot exceed matches_played.');
  }
  // 130 minutes per match allows for extra time plus stoppage.
  if (merged.minutes > merged.matches_played * 130) {
    throw new ApiError(400,
      `${merged.minutes} minutes is not possible in ${merged.matches_played} matches.`);
  }
  if (merged.pens_made > merged.goals) {
    throw new ApiError(400, 'pens_made cannot exceed goals.');
  }

  const nineties = Math.round((merged.minutes / 90) * 10) / 10;
  const per90 = (x) => (nineties > 0 ? Math.round((x / nineties) * 100) / 100 : null);
  const npg = merged.goals - merged.pens_made;

  return {
    ...merged,
    pens_att: Math.max(existing.pens_att ?? 0, merged.pens_made),
    nineties,
    goals_assists: merged.goals + merged.assists,
    goals_minus_pk: npg,
    goals_per90: per90(merged.goals),
    assists_per90: per90(merged.assists),
    ga_per90: per90(merged.goals + merged.assists),
    g_minus_pk_per90: per90(npg),
    ga_minus_pk_per90: per90(npg + merged.assists),
  };
}

const STANDARD_COLUMNS = [
  'matches_played', 'starts', 'minutes', 'nineties', 'goals', 'assists',
  'goals_assists', 'goals_minus_pk', 'pens_made', 'pens_att', 'cards_yellow',
  'cards_red', 'goals_per90', 'assists_per90', 'ga_per90', 'g_minus_pk_per90',
  'ga_minus_pk_per90',
];

async function upsertStandardStats(conn, playerSeasonId, stats) {
  const cols = ['player_season_id', ...STANDARD_COLUMNS];
  const values = [playerSeasonId, ...STANDARD_COLUMNS.map((c) => stats[c])];
  await conn.execute(
    `INSERT INTO stats_standard (${cols.join(', ')})
          VALUES (${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${STANDARD_COLUMNS.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
    values);
}

/** Resolves the reference ids a season row needs, or fails with a 400. */
async function resolveSeasonRefs(conn, { season_id, team_id, league_id, position_code }) {
  const checks = [];
  if (season_id !== undefined) checks.push(['season', 'SELECT start_year FROM seasons WHERE season_id = ?', season_id]);
  if (team_id !== undefined) checks.push(['club', 'SELECT 1 FROM teams WHERE team_id = ?', team_id]);
  if (league_id !== undefined) checks.push(['league', 'SELECT 1 FROM leagues WHERE league_id = ?', league_id]);

  const found = {};
  for (const [label, sql, id] of checks) {
    const [[row]] = await conn.execute(sql, [id]);
    if (!row) throw new ApiError(400, `No ${label} with id ${id}.`);
    found[label] = row;
  }

  let positionId;
  if (position_code !== undefined) {
    const [[pos]] = await conn.execute(
      'SELECT position_id FROM positions WHERE code = ?', [String(position_code).toUpperCase()]);
    if (!pos) throw new ApiError(400, 'position_code must be one of GK, DF, MF, FW.');
    positionId = pos.position_id;
  }
  return { seasonStartYear: found.season?.start_year, positionId };
}

/** Turns MySQL constraint errors into messages an admin can act on. */
function mapWriteError(err) {
  if (err.code === 'ER_DUP_ENTRY') {
    if (/uq_players_identity/.test(err.sqlMessage)) {
      return new ApiError(409, 'A player with that name and birth year already exists.');
    }
    if (/uq_player_team_season/.test(err.sqlMessage)) {
      return new ApiError(409, 'That player already has a season at that club.');
    }
    return new ApiError(409, 'That would create a duplicate record.');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return new ApiError(400, 'One of the selected nation, club, league or season does not exist.');
  }
  return err;
}

// ------------------------------------------------------------- read ---

// A player's identity plus every season with its ids and raw standard
// stats - what the edit form needs, which the public profile does not
// expose.
adminRouter.get('/players/:playerId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.playerId, 'playerId');
  const [player] = await query(
    `SELECT p.player_id, p.full_name, p.born_year, p.nation_id, n.code AS nation_code
       FROM players p LEFT JOIN nations n ON n.nation_id = p.nation_id
      WHERE p.player_id = ?`, [id]);
  if (!player) throw new ApiError(404, `No player with id ${id}.`);

  const seasons = await query(
    `SELECT ps.player_season_id, ps.season_id, s.label AS season_label,
            ps.team_id, t.name AS team_name, ps.league_id, l.name AS league_name,
            pos.code AS position_code, ps.age_years,
            std.matches_played, std.starts, std.minutes, std.goals, std.assists,
            std.pens_made, std.cards_yellow, std.cards_red, std.goals_per90,
            fp.total_points
       FROM player_seasons ps
       JOIN seasons s   ON s.season_id = ps.season_id
       JOIN teams t     ON t.team_id   = ps.team_id
       JOIN leagues l   ON l.league_id = ps.league_id
       LEFT JOIN positions pos      ON pos.position_id = ps.primary_position
       LEFT JOIN stats_standard std ON std.player_season_id = ps.player_season_id
       LEFT JOIN fantasy_points fp
              ON fp.player_season_id = ps.player_season_id
             AND fp.ruleset_id = fn_active_ruleset()
      WHERE ps.player_id = ?
      ORDER BY s.start_year DESC, t.name`, [id]);

  res.json({ ...player, seasons });
}));

// ----------------------------------------------------------- create ---

// A new player always arrives with their first season: the schema's grain
// is player x club x season, and a player with no season would appear
// nowhere in the app.
adminRouter.post('/players', asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const fullName = text(body.full_name, 'full_name', 80);
  const bornYear = int(body.born_year, 'born_year', 1950, 2015);
  const nationId = int(body.nation_id, 'nation_id', 1, 65535);

  const season = body.season ?? {};
  const seasonId = int(season.season_id, 'season.season_id', 1, 255, { required: true });
  const teamId = int(season.team_id, 'season.team_id', 1, 65535, { required: true });
  const leagueId = int(season.league_id, 'season.league_id', 1, 255, { required: true });
  if (!season.position_code) throw new ApiError(400, 'season.position_code is required.');
  const stats = buildStandardStats(season.stats ?? {});

  try {
    const created = await withTransaction(async (conn) => {
      const { seasonStartYear, positionId } = await resolveSeasonRefs(conn, {
        season_id: seasonId, team_id: teamId, league_id: leagueId,
        position_code: season.position_code,
      });

      // Age is derivable from the birth year and the season, so it only
      // needs typing in when the birth year is unknown.
      const age = int(season.age_years, 'season.age_years', 14, 50)
        ?? (bornYear && seasonStartYear ? seasonStartYear - bornYear : null);

      const [playerResult] = await conn.execute(
        'INSERT INTO players (full_name, born_year, nation_id) VALUES (?, ?, ?)',
        [fullName, bornYear, nationId]);
      const playerId = playerResult.insertId;

      const [psResult] = await conn.execute(
        `INSERT INTO player_seasons
           (player_id, team_id, league_id, season_id, age_years, primary_position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [playerId, teamId, leagueId, seasonId, age, positionId]);
      const playerSeasonId = psResult.insertId;

      await conn.execute(
        'INSERT INTO player_season_positions (player_season_id, position_id, is_primary) VALUES (?, ?, 1)',
        [playerSeasonId, positionId]);
      await upsertStandardStats(conn, playerSeasonId, stats);
      await conn.query('CALL sp_recalculate_player_season_points(?)', [playerSeasonId]);

      return { player_id: playerId, player_season_id: playerSeasonId };
    });

    res.status(201).json({ ...created, full_name: fullName });
  } catch (err) {
    throw mapWriteError(err);
  }
}));

// ----------------------------------------------------------- update ---

// Identity only: name, birth year, nationality. These live on `players`
// and are shared by every season.
adminRouter.put('/players/:playerId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.playerId, 'playerId');
  const body = req.body ?? {};
  const sets = [];
  const params = [];

  if ('full_name' in body) { sets.push('full_name = ?'); params.push(text(body.full_name, 'full_name', 80)); }
  if ('born_year' in body) { sets.push('born_year = ?'); params.push(int(body.born_year, 'born_year', 1950, 2015)); }
  if ('nation_id' in body) { sets.push('nation_id = ?'); params.push(int(body.nation_id, 'nation_id', 1, 65535)); }
  if (!sets.length) throw new ApiError(400, 'Nothing to update: send full_name, born_year or nation_id.');

  try {
    const result = await query(
      `UPDATE players SET ${sets.join(', ')} WHERE player_id = ?`, [...params, id]);
    if (!result.affectedRows) throw new ApiError(404, `No player with id ${id}.`);
  } catch (err) {
    throw mapWriteError(err);
  }
  res.json({ player_id: id, updated: sets.length });
}));

// One season: club, league, position, age and standard stats. The season
// itself cannot be changed - moving a row to another season would break
// the squads built from that season's player pool.
adminRouter.put('/player-seasons/:playerSeasonId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.playerSeasonId, 'playerSeasonId');
  const body = req.body ?? {};
  if ('season_id' in body) {
    throw new ApiError(400,
      'A season row cannot be moved to another season. Delete it and add a new one instead.');
  }

  try {
    const result = await withTransaction(async (conn) => {
      const [[current]] = await conn.execute(
        'SELECT player_season_id FROM player_seasons WHERE player_season_id = ? FOR UPDATE', [id]);
      if (!current) throw new ApiError(404, `No player-season with id ${id}.`);

      const teamId = int(body.team_id, 'team_id', 1, 65535);
      const leagueId = int(body.league_id, 'league_id', 1, 255);
      const { positionId } = await resolveSeasonRefs(conn, {
        team_id: teamId ?? undefined,
        league_id: leagueId ?? undefined,
        position_code: body.position_code ?? undefined,
      });

      const sets = [];
      const params = [];
      if (teamId !== null) { sets.push('team_id = ?'); params.push(teamId); }
      if (leagueId !== null) { sets.push('league_id = ?'); params.push(leagueId); }
      if ('age_years' in body) { sets.push('age_years = ?'); params.push(int(body.age_years, 'age_years', 14, 50)); }
      if (positionId !== undefined) { sets.push('primary_position = ?'); params.push(positionId); }
      if (sets.length) {
        await conn.execute(
          `UPDATE player_seasons SET ${sets.join(', ')} WHERE player_season_id = ?`, [...params, id]);
      }

      // Keep the positions junction in step with the primary position.
      if (positionId !== undefined) {
        await conn.execute(
          'DELETE FROM player_season_positions WHERE player_season_id = ? AND is_primary = 1', [id]);
        await conn.execute(
          `INSERT INTO player_season_positions (player_season_id, position_id, is_primary)
           VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE is_primary = 1`, [id, positionId]);
      }

      let statsChanged = false;
      if (body.stats && typeof body.stats === 'object') {
        const [[existing = {}]] = await conn.execute(
          'SELECT * FROM stats_standard WHERE player_season_id = ?', [id]);
        await upsertStandardStats(conn, id, buildStandardStats(body.stats, existing));
        statsChanged = true;
      }

      if (!sets.length && !statsChanged) {
        throw new ApiError(400,
          'Nothing to update: send team_id, league_id, position_code, age_years or stats.');
      }

      // Goals, minutes and position all feed the fantasy score.
      await conn.query('CALL sp_recalculate_player_season_points(?)', [id]);
      const [[points]] = await conn.execute(
        `SELECT total_points FROM fantasy_points
          WHERE player_season_id = ? AND ruleset_id = fn_active_ruleset()`, [id]);
      return { player_season_id: id, total_points: points?.total_points ?? null };
    });
    res.json(result);
  } catch (err) {
    throw mapWriteError(err);
  }
}));

// ----------------------------------------------------------- delete ---

// Hard delete. One DELETE on `players` is enough: every foreign key on the
// path players -> player_seasons -> (stats, fantasy_points, positions,
// shortlist entries, squad slots) is ON DELETE CASCADE. The dependent rows
// are counted first so the response can say exactly what went with it.
adminRouter.delete('/players/:playerId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.playerId, 'playerId');

  const summary = await withTransaction(async (conn) => {
    const [[player]] = await conn.execute(
      'SELECT player_id, full_name FROM players WHERE player_id = ? FOR UPDATE', [id]);
    if (!player) throw new ApiError(404, `No player with id ${id}.`);

    const [[counts]] = await conn.execute(
      `SELECT
         COUNT(*) AS seasons,
         (SELECT COUNT(*) FROM stats_standard x JOIN player_seasons y USING (player_season_id)
           WHERE y.player_id = ?) AS stat_rows,
         (SELECT COUNT(*) FROM shortlist_entries x JOIN player_seasons y USING (player_season_id)
           WHERE y.player_id = ?) AS shortlist_entries,
         (SELECT COUNT(*) FROM squad_players x JOIN player_seasons y USING (player_season_id)
           WHERE y.player_id = ?) AS squad_slots
       FROM player_seasons WHERE player_id = ?`, [id, id, id, id]);

    await conn.execute('DELETE FROM players WHERE player_id = ?', [id]);
    return { deleted: player.full_name, player_id: id, cascaded: counts };
  });

  res.json(summary);
}));
