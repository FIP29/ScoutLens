// Comparison, leaderboards and the league/team dashboards.
import { Router } from 'express';
import { query, callProc } from '../db/pool.js';
import { asyncHandler, ApiError, optionalInt, requiredInt } from '../lib/http.js';

export const analyticsRouter = Router();

// Head-to-head between two player-seasons.
analyticsRouter.get('/compare', asyncHandler(async (req, res) => {
  const left = requiredInt(req.query.left, 'left');
  const right = requiredInt(req.query.right, 'right');
  const rows = await callProc('sp_compare_players', [left, right]);
  if (rows.length < 2) {
    throw new ApiError(404, 'One or both player-seasons were not found');
  }
  res.json({
    left: rows.find((r) => r.player_season_id === left),
    right: rows.find((r) => r.player_season_id === right),
  });
}));

// Fantasy leaderboard, driven entirely by the stored procedure.
analyticsRouter.get('/leaderboard', asyncHandler(async (req, res) => {
  const rows = await callProc('sp_leaderboard', [
    optionalInt(req.query.season_id, 'season_id'),
    optionalInt(req.query.league_id, 'league_id'),
    req.query.position ? String(req.query.position).slice(0, 2).toUpperCase() : null,
    optionalInt(req.query.min_minutes, 'min_minutes') ?? 450,
    optionalInt(req.query.limit, 'limit') ?? 25,
  ]);
  res.json(rows);
}));

// Per-league totals for every season, for the dashboard charts.
analyticsRouter.get('/leagues', asyncHandler(async (req, res) => {
  const seasonId = optionalInt(req.query.season_id, 'season_id');
  res.json(await query(
    `SELECT * FROM v_league_season
      ${seasonId ? 'WHERE season_id = ?' : ''}
      ORDER BY start_year DESC, goals DESC`, seasonId ? [seasonId] : []));
}));

// Club table for one season.
analyticsRouter.get('/teams', asyncHandler(async (req, res) => {
  const seasonId = optionalInt(req.query.season_id, 'season_id');
  const leagueId = optionalInt(req.query.league_id, 'league_id');
  const clauses = [];
  const params = [];
  if (seasonId) { clauses.push('season_id = ?'); params.push(seasonId); }
  if (leagueId) { clauses.push('league_id = ?'); params.push(leagueId); }
  res.json(await query(
    `SELECT * FROM v_team_season
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY goals DESC LIMIT 200`, params));
}));

// One club in one season: summary line plus its full player list.
analyticsRouter.get('/teams/:teamId/seasons/:seasonId', asyncHandler(async (req, res) => {
  const teamId = requiredInt(req.params.teamId, 'teamId');
  const seasonId = requiredInt(req.params.seasonId, 'seasonId');
  const [summary] = await callProc('sp_team_season_summary', [teamId, seasonId]);
  if (!summary) throw new ApiError(404, 'No data for that club and season');

  const squad = await query(
    `SELECT vps.player_season_id, vps.player_id, vps.player_name, vps.position_code,
            vps.age_years, vps.nation_code, vps.matches_played, vps.minutes,
            vps.goals, vps.assists, fp.total_points
       FROM v_player_season vps
       LEFT JOIN fantasy_points fp
         ON fp.player_season_id = vps.player_season_id
        AND fp.ruleset_id = fn_active_ruleset()
      WHERE vps.team_id = ? AND vps.season_id = ?
      ORDER BY vps.minutes DESC`, [teamId, seasonId]);

  res.json({ summary, squad });
}));

// Which ruleset is live, and re-scoring after it changes.
analyticsRouter.get('/rulesets', asyncHandler(async (_req, res) => {
  res.json(await query(
    `SELECT r.ruleset_id, r.name, r.description, r.is_active,
            s.stat_key, s.points, s.unit, s.category, s.description AS rule_description,
            p.code AS position_code
       FROM fantasy_rulesets r
       JOIN fantasy_scoring_rules s ON s.ruleset_id = r.ruleset_id
       LEFT JOIN positions p ON p.position_id = s.position_id
      ORDER BY r.ruleset_id, s.category, s.stat_key`));
}));

// Switch the active ruleset and recompute every player's points.
analyticsRouter.post('/rulesets/:rulesetId/activate', asyncHandler(async (req, res) => {
  const rulesetId = requiredInt(req.params.rulesetId, 'rulesetId');
  const [exists] = await query(
    'SELECT ruleset_id FROM fantasy_rulesets WHERE ruleset_id = ?', [rulesetId]);
  if (!exists) throw new ApiError(404, `No ruleset with id ${rulesetId}`);

  await query('UPDATE fantasy_rulesets SET is_active = IF(ruleset_id = ?, 1, 0)', [rulesetId]);
  await callProc('sp_recalculate_fantasy_points', [rulesetId]);
  const [count] = await query(
    'SELECT COUNT(*) AS scored FROM fantasy_points WHERE ruleset_id = ?', [rulesetId]);
  res.json({ activated: rulesetId, scored: count.scored });
}));
