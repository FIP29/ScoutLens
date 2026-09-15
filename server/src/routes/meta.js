// Reference data that populates every dropdown in the filter form.
import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../lib/http.js';
import { FILTER_FIELDS, SORT_FIELDS } from '../lib/filters.js';

export const metaRouter = Router();

metaRouter.get('/', asyncHandler(async (_req, res) => {
  const [seasons, leagues, positions, nations, rulesets, totals] = await Promise.all([
    query('SELECT season_id, label, start_year FROM seasons ORDER BY start_year DESC'),
    query('SELECT league_id, name, country_code FROM leagues ORDER BY name'),
    query('SELECT position_id, code, name FROM positions ORDER BY sort_order'),
    query(`SELECT n.nation_id, n.code, n.flag_code, COUNT(p.player_id) AS players
             FROM nations n LEFT JOIN players p ON p.nation_id = n.nation_id
            GROUP BY n.nation_id, n.code, n.flag_code
            HAVING players > 0 ORDER BY players DESC, n.code`),
    query(`SELECT ruleset_id, name, description, is_active
             FROM fantasy_rulesets ORDER BY ruleset_id`),
    query(`SELECT
             (SELECT COUNT(*) FROM players)        AS players,
             (SELECT COUNT(*) FROM player_seasons) AS player_seasons,
             (SELECT COUNT(*) FROM teams)          AS teams,
             (SELECT COUNT(*) FROM seasons)        AS seasons,
             (SELECT COUNT(*) FROM leagues)        AS leagues`),
  ]);

  res.json({
    seasons, leagues, positions, nations, rulesets,
    totals: totals[0],
    // Advertise the filter grammar so the UI builds its form from the API
    // rather than hard-coding a second copy of the whitelist.
    filterFields: Object.fromEntries(
      Object.entries(FILTER_FIELDS).map(([k, v]) => [k, { type: v.type, ops: v.ops }])),
    sortFields: Object.keys(SORT_FIELDS),
  });
}));

// Teams, optionally narrowed to the clubs that appear in one season.
metaRouter.get('/teams', asyncHandler(async (req, res) => {
  const { season_id: seasonId, league_id: leagueId } = req.query;
  const clauses = [];
  const params = [];
  if (seasonId) { clauses.push('ps.season_id = ?'); params.push(Number(seasonId)); }
  if (leagueId) { clauses.push('ps.league_id = ?'); params.push(Number(leagueId)); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  res.json(await query(
    `SELECT DISTINCT t.team_id, t.name, l.name AS league_name
       FROM teams t
       JOIN player_seasons ps ON ps.team_id = t.team_id
       JOIN leagues l ON l.league_id = ps.league_id
       ${where}
      ORDER BY t.name`, params));
}));
