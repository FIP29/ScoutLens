// The write side of the app: shortlists, squads and saved searches.
import { Router } from 'express';
import { query, callProc, pool } from '../db/pool.js';
import { asyncHandler, ApiError, requiredInt } from '../lib/http.js';

export const scoutingRouter = Router();

// The demo app runs as a single seeded scout rather than shipping half an
// auth system; every write is scoped to this user.
const DEMO_USER = 1;

function text(value, field, max) {
  const s = String(value ?? '').trim();
  if (!s) throw new ApiError(400, `${field} is required`);
  if (s.length > max) throw new ApiError(400, `${field} must be at most ${max} characters`);
  return s;
}

// ------------------------------ shortlists ------------------------------

scoutingRouter.get('/shortlists', asyncHandler(async (_req, res) => {
  res.json(await query(
    `SELECT s.shortlist_id, s.name, s.notes, s.created_at,
            COUNT(e.player_season_id) AS players
       FROM shortlists s
       LEFT JOIN shortlist_entries e ON e.shortlist_id = s.shortlist_id
      WHERE s.user_id = ?
      GROUP BY s.shortlist_id, s.name, s.notes, s.created_at
      ORDER BY s.created_at DESC`, [DEMO_USER]));
}));

scoutingRouter.post('/shortlists', asyncHandler(async (req, res) => {
  const name = text(req.body?.name, 'name', 60);
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;
  try {
    const result = await query(
      'INSERT INTO shortlists (user_id, name, notes) VALUES (?, ?, ?)',
      [DEMO_USER, name, notes]);
    res.status(201).json({ shortlist_id: result.insertId, name, notes });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, `You already have a shortlist called "${name}"`);
    throw err;
  }
}));

// Columns a shortlist may be sorted by. Same whitelist discipline as the
// player search: the client sends a name, never a fragment of SQL.
const SHORTLIST_SORTS = {
  added_at: 'e.added_at',
  rating: 'e.rating',
  status: 'e.status',
  player_name: 'vps.player_name',
  age_years: 'vps.age_years',
  minutes: 'vps.minutes',
  goals: 'vps.goals',
  assists: 'vps.assists',
  total_points: 'fp.total_points',
};

const ENTRY_STATUSES = ['watching', 'shortlisted', 'priority', 'rejected'];

scoutingRouter.get('/shortlists/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const [shortlist] = await query(
    'SELECT * FROM shortlists WHERE shortlist_id = ? AND user_id = ?', [id, DEMO_USER]);
  if (!shortlist) throw new ApiError(404, `No shortlist with id ${id}`);

  const sortColumn = SHORTLIST_SORTS[req.query.sort] || SHORTLIST_SORTS.added_at;
  const direction = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const params = [id];
  let statusFilter = '';
  if (req.query.status) {
    const status = String(req.query.status);
    if (!ENTRY_STATUSES.includes(status)) {
      throw new ApiError(400, `status must be one of ${ENTRY_STATUSES.join(', ')}`);
    }
    statusFilter = 'AND e.status = ?';
    params.push(status);
  }

  const entries = await query(
    `SELECT e.player_season_id, e.rating, e.note, e.status, e.added_at, e.updated_at,
            vps.player_id, vps.player_name, vps.team_name, vps.league_name,
            vps.season_label, vps.position_code, vps.nation_code, vps.flag_code,
            vps.age_years, vps.minutes, vps.goals, vps.assists, vps.goals_per90,
            vps.clean_sheets, vps.saves, fp.total_points, fp.points_per90
       FROM shortlist_entries e
       JOIN v_player_season vps ON vps.player_season_id = e.player_season_id
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = e.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE e.shortlist_id = ? ${statusFilter}
      ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${direction}, vps.player_name ASC`,
    params);

  // Aggregates for the summary panel, computed in SQL rather than by
  // reducing the rows in JavaScript.
  const [summary] = await query(
    `SELECT COUNT(*) AS total,
            ROUND(AVG(vps.age_years), 1)     AS avg_age,
            SUM(vps.goals)                   AS goals,
            SUM(vps.assists)                 AS assists,
            SUM(vps.minutes)                 AS minutes,
            ROUND(AVG(fp.total_points), 1)   AS avg_points,
            ROUND(AVG(e.rating), 1)          AS avg_rating,
            SUM(e.status = 'priority')       AS priority,
            SUM(e.status = 'shortlisted')    AS shortlisted,
            SUM(e.status = 'watching')       AS watching,
            SUM(e.status = 'rejected')       AS rejected,
            COUNT(DISTINCT vps.nation_code)  AS nations,
            COUNT(DISTINCT vps.team_id)      AS clubs
       FROM shortlist_entries e
       JOIN v_player_season vps ON vps.player_season_id = e.player_season_id
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = e.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE e.shortlist_id = ?`, [id]);

  const byPosition = await query(
    `SELECT COALESCE(vps.position_code, '—') AS position_code, COUNT(*) AS n
       FROM shortlist_entries e
       JOIN v_player_season vps ON vps.player_season_id = e.player_season_id
      WHERE e.shortlist_id = ?
      GROUP BY vps.position_code ORDER BY n DESC`, [id]);

  res.json({ ...shortlist, entries, summary, byPosition });
}));

// Update a scout's own assessment of a player already on the list.
scoutingRouter.patch('/shortlists/:id/entries/:playerSeasonId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const psId = requiredInt(req.params.playerSeasonId, 'playerSeasonId');

  const sets = [];
  const params = [];

  if ('rating' in (req.body ?? {})) {
    const rating = req.body.rating === null ? null : requiredInt(req.body.rating, 'rating');
    if (rating !== null && (rating < 1 || rating > 5)) {
      throw new ApiError(400, 'rating must be between 1 and 5');
    }
    sets.push('rating = ?');
    params.push(rating);
  }
  if ('note' in (req.body ?? {})) {
    sets.push('note = ?');
    params.push(req.body.note ? String(req.body.note).slice(0, 300) : null);
  }
  if ('status' in (req.body ?? {})) {
    if (!ENTRY_STATUSES.includes(req.body.status)) {
      throw new ApiError(400, `status must be one of ${ENTRY_STATUSES.join(', ')}`);
    }
    sets.push('status = ?');
    params.push(req.body.status);
  }
  if (!sets.length) throw new ApiError(400, 'Nothing to update: send rating, note or status');

  params.push(id, psId);
  const result = await query(
    `UPDATE shortlist_entries SET ${sets.join(', ')}
      WHERE shortlist_id = ? AND player_season_id = ?`, params);
  if (!result.affectedRows) throw new ApiError(404, 'That player is not on the shortlist');

  res.json({ shortlist_id: id, player_season_id: psId, updated: sets.length });
}));

// Move a player from one shortlist to another, keeping the assessment.
scoutingRouter.post('/shortlists/:id/entries/:playerSeasonId/move', asyncHandler(async (req, res) => {
  const from = requiredInt(req.params.id, 'id');
  const psId = requiredInt(req.params.playerSeasonId, 'playerSeasonId');
  const to = requiredInt(req.body?.target_shortlist_id, 'target_shortlist_id');
  if (from === to) throw new ApiError(400, 'Source and target shortlist are the same');

  const [target] = await query(
    'SELECT shortlist_id FROM shortlists WHERE shortlist_id = ? AND user_id = ?',
    [to, DEMO_USER]);
  if (!target) throw new ApiError(404, `No shortlist with id ${to}`);

  // One statement, so the player can never exist in both lists or neither.
  const result = await query(
    `UPDATE IGNORE shortlist_entries SET shortlist_id = ?
      WHERE shortlist_id = ? AND player_season_id = ?`, [to, from, psId]);
  if (!result.affectedRows) {
    throw new ApiError(409, 'That player is not on this list, or is already on the target list');
  }
  res.json({ moved: psId, from, to });
}));

scoutingRouter.post('/shortlists/:id/entries', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const playerSeasonId = requiredInt(req.body?.player_season_id, 'player_season_id');
  const rating = req.body?.rating == null ? null : requiredInt(req.body.rating, 'rating');
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new ApiError(400, 'rating must be between 1 and 5');
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
  const status = req.body?.status ?? 'watching';
  if (!ENTRY_STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of ${ENTRY_STATUSES.join(', ')}`);
  }

  try {
    await query(
      `INSERT INTO shortlist_entries (shortlist_id, player_season_id, rating, note, status)
            VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), note = VALUES(note),
                               status = VALUES(status)`,
      [id, playerSeasonId, rating, note, status]);
    res.status(201).json({ shortlist_id: id, player_season_id: playerSeasonId, rating, note, status });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new ApiError(404, 'That shortlist or player-season does not exist');
    }
    throw err;
  }
}));

scoutingRouter.delete('/shortlists/:id/entries/:playerSeasonId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const psId = requiredInt(req.params.playerSeasonId, 'playerSeasonId');
  const result = await query(
    'DELETE FROM shortlist_entries WHERE shortlist_id = ? AND player_season_id = ?', [id, psId]);
  if (!result.affectedRows) throw new ApiError(404, 'That player is not on the shortlist');
  res.status(204).end();
}));

scoutingRouter.delete('/shortlists/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const result = await query(
    'DELETE FROM shortlists WHERE shortlist_id = ? AND user_id = ?', [id, DEMO_USER]);
  if (!result.affectedRows) throw new ApiError(404, `No shortlist with id ${id}`);
  res.status(204).end();
}));

// -------------------------------- squads --------------------------------

scoutingRouter.get('/squads', asyncHandler(async (_req, res) => {
  res.json(await query(
    `SELECT sq.squad_id, sq.name, sq.formation, s.label AS season_label, sq.season_id,
            COUNT(sp.player_season_id) AS players,
            ROUND(SUM(fp.total_points), 2) AS projected_points
       FROM squads sq
       JOIN seasons s ON s.season_id = sq.season_id
       LEFT JOIN squad_players sp ON sp.squad_id = sq.squad_id
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = sp.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE sq.user_id = ?
      GROUP BY sq.squad_id, sq.name, sq.formation, s.label, sq.season_id
      ORDER BY sq.updated_at DESC`, [DEMO_USER]));
}));

scoutingRouter.post('/squads', asyncHandler(async (req, res) => {
  const name = text(req.body?.name, 'name', 60);
  const seasonId = requiredInt(req.body?.season_id, 'season_id');
  const formation = req.body?.formation ? String(req.body.formation).slice(0, 10) : '4-4-2';
  try {
    const result = await query(
      'INSERT INTO squads (user_id, season_id, name, formation) VALUES (?, ?, ?, ?)',
      [DEMO_USER, seasonId, name, formation]);
    res.status(201).json({ squad_id: result.insertId, name, season_id: seasonId, formation });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, `You already have a squad called "${name}"`);
    if (err.code === 'ER_NO_REFERENCED_ROW_2') throw new ApiError(404, 'That season does not exist');
    throw err;
  }
}));

// NOTE: these must be declared before '/squads/:id'. Express matches
// routes in order, so a literal path registered after a parameterised
// one is never reached - '/squads/compare' would bind id='compare'.
// -------------------------- squad comparison ---------------------------

// Ratings for one squad on their own.
scoutingRouter.get('/squads/:id/strength', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const [strength] = await callProc('sp_squad_strength', [id]);
  if (!strength) {
    throw new ApiError(404,
      'No ratings for that squad - it needs at least one non-bench player.');
  }
  res.json(strength);
}));

// Head to head between two saved squads.
scoutingRouter.get('/squads/compare', asyncHandler(async (req, res) => {
  const a = requiredInt(req.query.a, 'a');
  const b = requiredInt(req.query.b, 'b');

  const [comparison] = await callProc('sp_compare_squads', [a, b]);
  if (!comparison) {
    throw new ApiError(404,
      'Could not rate both squads. Each needs at least one player outside the bench.');
  }

  const [grid, lineups] = await Promise.all([
    callProc('sp_squad_scoreline_grid', [a, b]),
    query(
      `SELECT sp.squad_id, sp.slot, sp.is_captain,
              vps.player_name, vps.position_code, vps.team_name,
              vps.minutes, vps.goals, vps.assists,
              vs.attack_per90, vs.conceded_per90, fp.total_points
         FROM squad_players sp
         JOIN v_player_season vps  ON vps.player_season_id = sp.player_season_id
         JOIN v_player_strength vs ON vs.player_season_id  = sp.player_season_id
         LEFT JOIN fantasy_points fp
           ON fp.player_season_id = sp.player_season_id
          AND fp.ruleset_id = fn_active_ruleset()
        WHERE sp.squad_id IN (?, ?) AND sp.slot <> 'BENCH'
        ORDER BY sp.squad_id, vs.attack_per90 DESC`, [a, b]),
  ]);

  res.json({
    comparison,
    grid,
    lineups: {
      a: lineups.filter((r) => r.squad_id === a),
      b: lineups.filter((r) => r.squad_id === b),
    },
  });
}));

scoutingRouter.get('/squads/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const [squad] = await query(
    `SELECT sq.*, s.label AS season_label
       FROM squads sq JOIN seasons s ON s.season_id = sq.season_id
      WHERE sq.squad_id = ? AND sq.user_id = ?`, [id, DEMO_USER]);
  if (!squad) throw new ApiError(404, `No squad with id ${id}`);

  const [players, projection] = await Promise.all([
    query(
      `SELECT sp.player_season_id, sp.slot, sp.is_captain,
              vps.player_name, vps.team_name, vps.position_code, vps.age_years,
              vps.minutes, vps.goals, vps.assists, vps.clean_sheets, vps.saves,
              fp.total_points, fp.points_per90
         FROM squad_players sp
         JOIN v_player_season vps ON vps.player_season_id = sp.player_season_id
         LEFT JOIN fantasy_points fp
           ON fp.player_season_id = sp.player_season_id
          AND fp.ruleset_id = fn_active_ruleset()
        WHERE sp.squad_id = ?
        ORDER BY FIELD(sp.slot, 'GK','DEF','MID','FWD','BENCH'), fp.total_points DESC`, [id]),
    callProc('sp_squad_projection', [id]),
  ]);

  res.json({ ...squad, players, projection: projection[0] ?? null });
}));

scoutingRouter.post('/squads/:id/players', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const playerSeasonId = requiredInt(req.body?.player_season_id, 'player_season_id');
  const slot = String(req.body?.slot ?? '').toUpperCase();
  if (!['GK', 'DEF', 'MID', 'FWD', 'BENCH'].includes(slot)) {
    throw new ApiError(400, 'slot must be one of GK, DEF, MID, FWD, BENCH');
  }
  const isCaptain = req.body?.is_captain ? 1 : 0;

  try {
    await query(
      'INSERT INTO squad_players (squad_id, player_season_id, slot, is_captain) VALUES (?, ?, ?, ?)',
      [id, playerSeasonId, slot, isCaptain]);
  } catch (err) {
    // The database enforces squad size, captain uniqueness and the
    // season match; surface those messages rather than a 500.
    if (err.sqlState === '45000') throw new ApiError(409, err.sqlMessage);
    if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'That player is already in the squad');
    if (err.code === 'ER_NO_REFERENCED_ROW_2') throw new ApiError(404, 'Squad or player-season not found');
    throw err;
  }
  const [projection] = await callProc('sp_squad_projection', [id]);
  res.status(201).json({ squad_id: id, player_season_id: playerSeasonId, slot, projection });
}));

scoutingRouter.delete('/squads/:id/players/:playerSeasonId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const psId = requiredInt(req.params.playerSeasonId, 'playerSeasonId');
  const result = await query(
    'DELETE FROM squad_players WHERE squad_id = ? AND player_season_id = ?', [id, psId]);
  if (!result.affectedRows) throw new ApiError(404, 'That player is not in the squad');
  res.status(204).end();
}));

scoutingRouter.delete('/squads/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const result = await query(
    'DELETE FROM squads WHERE squad_id = ? AND user_id = ?', [id, DEMO_USER]);
  if (!result.affectedRows) throw new ApiError(404, `No squad with id ${id}`);
  res.status(204).end();
}));

// ---------------------------- saved searches ----------------------------

scoutingRouter.get('/searches', asyncHandler(async (_req, res) => {
  res.json(await query(
    'SELECT search_id, name, criteria, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC',
    [DEMO_USER]));
}));

scoutingRouter.post('/searches', asyncHandler(async (req, res) => {
  const name = text(req.body?.name, 'name', 60);
  const criteria = req.body?.criteria;
  if (!criteria || typeof criteria !== 'object') {
    throw new ApiError(400, 'criteria must be an object');
  }
  try {
    const result = await query(
      'INSERT INTO saved_searches (user_id, name, criteria) VALUES (?, ?, ?)',
      [DEMO_USER, name, JSON.stringify(criteria)]);
    res.status(201).json({ search_id: result.insertId, name, criteria });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, `You already have a search called "${name}"`);
    throw err;
  }
}));

scoutingRouter.delete('/searches/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const result = await query(
    'DELETE FROM saved_searches WHERE search_id = ? AND user_id = ?', [id, DEMO_USER]);
  if (!result.affectedRows) throw new ApiError(404, `No saved search with id ${id}`);
  res.status(204).end();
}));
