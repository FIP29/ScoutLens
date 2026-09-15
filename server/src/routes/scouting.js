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

scoutingRouter.get('/shortlists/:id', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const [shortlist] = await query(
    'SELECT * FROM shortlists WHERE shortlist_id = ? AND user_id = ?', [id, DEMO_USER]);
  if (!shortlist) throw new ApiError(404, `No shortlist with id ${id}`);

  const entries = await query(
    `SELECT e.player_season_id, e.rating, e.note, e.added_at,
            vps.player_name, vps.team_name, vps.league_name, vps.season_label,
            vps.position_code, vps.age_years, vps.minutes, vps.goals, vps.assists,
            fp.total_points
       FROM shortlist_entries e
       JOIN v_player_season vps ON vps.player_season_id = e.player_season_id
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = e.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE e.shortlist_id = ?
      ORDER BY e.added_at DESC`, [id]);

  res.json({ ...shortlist, entries });
}));

scoutingRouter.post('/shortlists/:id/entries', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.id, 'id');
  const playerSeasonId = requiredInt(req.body?.player_season_id, 'player_season_id');
  const rating = req.body?.rating == null ? null : requiredInt(req.body.rating, 'rating');
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new ApiError(400, 'rating must be between 1 and 5');
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;

  try {
    await query(
      `INSERT INTO shortlist_entries (shortlist_id, player_season_id, rating, note)
            VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), note = VALUES(note)`,
      [id, playerSeasonId, rating, note]);
    res.status(201).json({ shortlist_id: id, player_season_id: playerSeasonId, rating, note });
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
