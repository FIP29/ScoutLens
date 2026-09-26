// ---------------------------------------------------------------------
// Above-average performers.
//
// For a chosen position and statistic, returns the players whose value
// beats the average of their peers - the other players in the same
// league, at the same position, in the same season.
//
// The peer average is computed by MySQL as a correlated subquery, once
// per candidate row, never in JavaScript. The query also spells out its
// JOINs (players, player_seasons, teams, leagues, positions and the stats
// tables) instead of reading v_player_season, so the relational work is
// visible in the SQL itself.
//
// Public: no login needed.
// ---------------------------------------------------------------------

import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler, ApiError, optionalInt } from '../lib/http.js';

export const peersRouter = Router();

// Each stat is an expression over table aliases, so the same definition
// can be written once for the outer row (std, sh, ms, gk) and once for the
// peer subquery (std2, sh2, ms2, gk2). Column names cannot be bound as ?
// parameters, which is why the client picks a KEY from this whitelist and
// only the matching expression ever reaches the SQL string.
//
// `lower` marks stats where a smaller number is better (goals conceded):
// "outperforming" then means sitting below the peer average.
const STATS = {
  // attacking
  goals:            { label: 'Goals',                   group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.goals` },
  goals_per90:      { label: 'Goals per 90',            group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.goals_per90` },
  assists:          { label: 'Assists',                 group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.assists` },
  assists_per90:    { label: 'Assists per 90',          group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.assists_per90` },
  goals_assists:    { label: 'Goals + assists',         group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.goals_assists` },
  ga_per90:         { label: 'Goals + assists per 90',  group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.ga_per90` },
  npg:              { label: 'Non-penalty goals',       group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.goals_minus_pk` },
  npg_per90:        { label: 'Non-penalty goals per 90',group: 'Attacking',   table: 'std', expr: (a) => `${a.std}.g_minus_pk_per90` },
  shots:            { label: 'Shots',                   group: 'Attacking',   table: 'sh',  expr: (a) => `${a.sh}.shots` },
  shots_per90:      { label: 'Shots per 90',            group: 'Attacking',   table: 'sh',  expr: (a) => `${a.sh}.shots_per90` },
  sot:              { label: 'Shots on target',         group: 'Attacking',   table: 'sh',  expr: (a) => `${a.sh}.shots_on_target` },
  sot_per90:        { label: 'Shots on target per 90',  group: 'Attacking',   table: 'sh',  expr: (a) => `${a.sh}.sot_per90` },
  // defending - per-90 versions are derived, since FBref does not store them
  tackles_won:      { label: 'Tackles won',             group: 'Defending',   table: 'ms',  expr: (a) => `${a.ms}.tackles_won` },
  tackles_per90:    { label: 'Tackles won per 90',      group: 'Defending',   table: 'ms',
                      expr: (a) => `${a.ms}.tackles_won / NULLIF(${a.std}.nineties, 0)` },
  interceptions:    { label: 'Interceptions',           group: 'Defending',   table: 'ms',  expr: (a) => `${a.ms}.interceptions` },
  interceptions_per90: { label: 'Interceptions per 90', group: 'Defending',   table: 'ms',
                      expr: (a) => `${a.ms}.interceptions / NULLIF(${a.std}.nineties, 0)` },
  // goalkeeping
  clean_sheets:     { label: 'Clean sheets',            group: 'Goalkeeping', table: 'gk',  expr: (a) => `${a.gk}.clean_sheets` },
  saves:            { label: 'Saves',                   group: 'Goalkeeping', table: 'gk',  expr: (a) => `${a.gk}.saves` },
  save_pct:         { label: 'Save %',                  group: 'Goalkeeping', table: 'gk',  expr: (a) => `${a.gk}.save_pct` },
  goals_against_p90:{ label: 'Goals conceded per 90',   group: 'Goalkeeping', table: 'gk',  lower: true,
                      expr: (a) => `${a.gk}.goals_against_p90` },
};

// Table each alias refers to. stats_standard is always joined: it holds
// the minutes used by the minimum-minutes filter on both sides.
const TABLES = {
  std: 'stats_standard',
  sh: 'stats_shooting',
  ms: 'stats_misc',
  gk: 'stats_keeper',
};

const POSITIONS = ['GK', 'DF', 'MF', 'FW'];
const MAX_ROWS = 500;

/** The extra stats-table JOIN a stat needs, for one set of aliases. */
function statJoin(stat, a, psAlias) {
  if (stat.table === 'std') return '';
  return `JOIN ${TABLES[stat.table]} ${a[stat.table]}
            ON ${a[stat.table]}.player_season_id = ${psAlias}.player_season_id`;
}

// The stat catalogue, for the page's dropdown.
peersRouter.get('/stats', (_req, res) => {
  res.json(Object.entries(STATS).map(([key, s]) => ({
    key, label: s.label, group: s.group, lower_is_better: Boolean(s.lower),
  })));
});

peersRouter.get('/above-average', asyncHandler(async (req, res) => {
  const statKey = String(req.query.stat ?? '');
  const stat = STATS[statKey];
  if (!stat) {
    throw new ApiError(400,
      `Unknown stat "${statKey}". Choose one of: ${Object.keys(STATS).join(', ')}`);
  }

  const position = String(req.query.position ?? '').toUpperCase();
  if (!POSITIONS.includes(position)) {
    throw new ApiError(400, `position must be one of ${POSITIONS.join(', ')}`);
  }

  const seasonId = optionalInt(req.query.season_id, 'season_id');
  const leagueId = optionalInt(req.query.league_id, 'league_id');
  const minMinutes = optionalInt(req.query.min_minutes, 'min_minutes') ?? 900;

  const outer = { std: 'std', sh: 'sh', ms: 'ms', gk: 'gk' };
  const inner = { std: 'std2', sh: 'sh2', ms: 'ms2', gk: 'gk2' };

  const valueExpr = stat.expr(outer);
  const peerExpr = stat.expr(inner);
  const beats = stat.lower ? '<' : '>';

  // The peer group. Correlated on the OUTER row's season, league and
  // position (ps.*), so each candidate is compared with its own peers.
  // The same minimum-minutes floor applies to the peers as to the
  // candidates, so a handful of 20-minute cameos cannot drag the
  // average down and make everyone look good.
  const peerFrom = `
          FROM player_seasons ps2
          JOIN stats_standard std2 ON std2.player_season_id = ps2.player_season_id
          ${statJoin(stat, inner, 'ps2')}
         WHERE ps2.season_id        = ps.season_id
           AND ps2.league_id        = ps.league_id
           AND ps2.primary_position = ps.primary_position
           AND std2.minutes >= ?
           AND ${peerExpr} IS NOT NULL`;

  const where = ['pos.code = ?', 'std.minutes >= ?', `${valueExpr} IS NOT NULL`];
  // Placeholder order must match the SQL text: the two subqueries in the
  // SELECT list come first, then the outer WHERE.
  const params = [minMinutes, minMinutes, position, minMinutes];
  if (seasonId) { where.push('ps.season_id = ?'); params.push(seasonId); }
  if (leagueId) { where.push('ps.league_id = ?'); params.push(leagueId); }

  const sql = `
    SELECT
      ps.player_season_id,
      p.player_id,
      p.full_name        AS player_name,
      n.code             AS nation_code,
      n.flag_code,
      t.name             AS team_name,
      l.name             AS league_name,
      s.label            AS season_label,
      pos.code           AS position_code,
      ps.age_years,
      std.minutes,
      -- Unrounded: HAVING compares these exactly. Rounding happens only
      -- for display, below, so a player 0.0003 above average is not lost
      -- to both numbers rounding to the same value.
      ${valueExpr} AS value,
      (SELECT AVG(${peerExpr}) ${peerFrom}) AS peer_avg,
      (SELECT COUNT(*)                   ${peerFrom}) AS peer_count
    FROM player_seasons ps
    JOIN players        p   ON p.player_id       = ps.player_id
    JOIN teams          t   ON t.team_id         = ps.team_id
    JOIN leagues        l   ON l.league_id       = ps.league_id
    JOIN seasons        s   ON s.season_id       = ps.season_id
    JOIN positions      pos ON pos.position_id   = ps.primary_position
    LEFT JOIN nations   n   ON n.nation_id       = p.nation_id
    JOIN stats_standard std ON std.player_season_id = ps.player_season_id
    ${statJoin(stat, outer, 'ps')}
    WHERE ${where.join(' AND ')}
    -- HAVING can see the SELECT-list aliases, so the peer average is
    -- computed once per row and then filtered, rather than evaluated a
    -- second time inside WHERE.
    HAVING value ${beats} peer_avg
    ORDER BY ABS(value - peer_avg) DESC, player_name
    LIMIT ${MAX_ROWS + 1}`;

  // The two peer subqueries each take the minutes floor, hence it
  // appears twice at the front of the parameter list.
  const rows = await query(sql, params);

  const truncated = rows.length > MAX_ROWS;
  const round3 = (x) => (x === null ? null : Math.round(Number(x) * 1000) / 1000);
  const result = rows.slice(0, MAX_ROWS).map((r) => {
    const value = Number(r.value);
    const avg = Number(r.peer_avg);
    const margin = stat.lower ? avg - value : value - avg;
    return {
      ...r,
      value: round3(value),
      peer_avg: round3(avg),
      margin: round3(margin),
      pct_above: avg ? Math.round((margin / avg) * 1000) / 10 : null,
    };
  });

  res.json({
    stat: { key: statKey, label: stat.label, lower_is_better: Boolean(stat.lower) },
    position,
    min_minutes: minMinutes,
    count: result.length,
    truncated,
    rows: result,
  });
}));
