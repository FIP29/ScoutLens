// Player search, profiles and head-to-head comparison.
import { Router } from 'express';
import { query, callProc } from '../db/pool.js';
import { asyncHandler, ApiError, optionalInt, requiredInt } from '../lib/http.js';
import { buildWhere, buildOrderBy, filtersFromQuery } from '../lib/filters.js';

export const playersRouter = Router();

const MAX_PAGE_SIZE = 100;

/**
 * The shared search implementation. The filter list arrives either as a
 * JSON body (the React filter builder) or as query-string shorthand
 * (?goals_gte=10), and both go through the same whitelist.
 */
async function runSearch({ filters, sort, dir, page, pageSize }) {
  const { sql: where, params } = buildWhere(filters);
  const orderBy = buildOrderBy(sort, dir);
  const limit = Math.min(Math.max(pageSize ?? 25, 1), MAX_PAGE_SIZE);
  const offset = Math.max((page ?? 1) - 1, 0) * limit;

  const from = `
    FROM v_player_season vps
    LEFT JOIN fantasy_points fp
      ON  fp.player_season_id = vps.player_season_id
      AND fp.ruleset_id       = fn_active_ruleset()
    ${where}`;

  // Count and page are two round trips rather than SQL_CALC_FOUND_ROWS,
  // which is deprecated and slower on InnoDB.
  const [countRow] = await query(`SELECT COUNT(*) AS total ${from}`, params);

  const rows = await query(
    `SELECT vps.player_season_id, vps.player_id, vps.player_name, vps.nation_code,
            vps.flag_code, vps.age_years, vps.team_id, vps.team_name, vps.league_name,
            vps.season_label, vps.season_id, vps.position_code, vps.all_positions,
            vps.matches_played, vps.starts, vps.minutes, vps.minutes_pct,
            vps.goals, vps.assists, vps.goals_assists, vps.goals_per90, vps.assists_per90,
            vps.shots, vps.shots_on_target, vps.cards_yellow, vps.cards_red,
            vps.clean_sheets, vps.saves, vps.save_pct,
            fp.total_points, fp.points_per90
     ${from}
     ${orderBy}
     LIMIT ${limit} OFFSET ${offset}`, params);

  return {
    rows,
    pagination: {
      page: page ?? 1,
      pageSize: limit,
      total: countRow.total,
      totalPages: Math.ceil(countRow.total / limit) || 1,
    },
  };
}

// GET shorthand: /api/players/search?goals_gte=10&league_id=1&sort=goals
playersRouter.get('/search', asyncHandler(async (req, res) => {
  res.json(await runSearch({
    filters: filtersFromQuery(req.query),
    sort: req.query.sort,
    dir: req.query.dir,
    page: optionalInt(req.query.page, 'page') || 1,
    pageSize: optionalInt(req.query.pageSize, 'pageSize') || 25,
  }));
}));

// POST form: the filter builder sends a structured criteria list.
playersRouter.post('/search', asyncHandler(async (req, res) => {
  const { filters = [], sort, dir, page = 1, pageSize = 25 } = req.body ?? {};
  if (!Array.isArray(filters)) throw new ApiError(400, '`filters` must be an array');
  res.json(await runSearch({ filters, sort, dir, page, pageSize }));
}));

// Typeahead for the comparison pickers.
playersRouter.get('/suggest', asyncHandler(async (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 2) return res.json([]);
  const escaped = term.replace(/[%_\\]/g, (c) => `\\${c}`);
  res.json(await query(
    `SELECT player_id, player_name, nation_code, positions, latest_team,
            seasons_played, goals, assists
       FROM v_player_career
      WHERE player_name LIKE ?
      ORDER BY goals_assists DESC, player_name
      LIMIT 15`, [`%${escaped}%`]));
}));

// Career summary + season-by-season trend for one player.
playersRouter.get('/:playerId', asyncHandler(async (req, res) => {
  const playerId = requiredInt(req.params.playerId, 'playerId');
  const [career] = await query(
    'SELECT * FROM v_player_career WHERE player_id = ?', [playerId]);
  if (!career) throw new ApiError(404, `No player with id ${playerId}`);

  const [trend, progression] = await Promise.all([
    callProc('sp_player_trend', [playerId]),
    query(`SELECT season_label, goals_delta, assists_delta, minutes_delta, previous_team
             FROM v_player_progression WHERE player_id = ? ORDER BY start_year`, [playerId]),
  ]);

  res.json({ career, trend, progression });
}));

// Full detail for a single player-season row.
playersRouter.get('/season/:playerSeasonId', asyncHandler(async (req, res) => {
  const id = requiredInt(req.params.playerSeasonId, 'playerSeasonId');
  const [row] = await query(
    `SELECT vps.*, fp.total_points, fp.points_per90, fp.points_per_match,
            fp.attack_points, fp.defence_points, fp.discipline_points
       FROM v_player_season vps
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = vps.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE vps.player_season_id = ?`, [id]);
  if (!row) throw new ApiError(404, `No player-season with id ${id}`);
  res.json(row);
}));
