-- =====================================================================
-- ScoutLens - views
--
-- These exist so the Express layer never has to hand-assemble the same
-- eight-table join, and so season-over-season aggregates are computed by
-- MySQL rather than re-derived in JavaScript per request.
-- =====================================================================

USE scoutlens;

-- ---------------------------------------------------------------------
-- The workhorse: one flat, fully-labelled row per player-club-season.
-- Every search, filter and profile query in the API reads from here.
-- LEFT JOINs throughout because a fringe player has playing-time data
-- only, and an outfielder has no keeper row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_player_season AS
SELECT
  ps.player_season_id,
  ps.player_id,
  p.full_name              AS player_name,
  p.born_year,
  ps.age_years,
  ps.age_days,
  n.code                   AS nation_code,
  n.flag_code,
  t.team_id,
  t.name                   AS team_name,
  l.league_id,
  l.name                   AS league_name,
  l.country_code,
  s.season_id,
  s.label                  AS season_label,
  s.start_year,
  pos.code                 AS position_code,
  pos.name                 AS position_name,
  -- Every position the player is listed under, e.g. 'MF,FW'
  (SELECT GROUP_CONCAT(p2.code ORDER BY p2.sort_order SEPARATOR ',')
     FROM player_season_positions psp
     JOIN positions p2 ON p2.position_id = psp.position_id
    WHERE psp.player_season_id = ps.player_season_id) AS all_positions,
  -- Minutes come from Standard when present, else the Playing Time export
  COALESCE(std.matches_played, pt.matches_played, 0) AS matches_played,
  COALESCE(std.starts,         pt.starts,         0) AS starts,
  COALESCE(std.minutes,        0)                    AS minutes,
  COALESCE(std.nineties,       pt.nineties,       0) AS nineties,
  COALESCE(std.goals, 0)          AS goals,
  COALESCE(std.assists, 0)        AS assists,
  COALESCE(std.goals_assists, 0)  AS goals_assists,
  COALESCE(std.goals_minus_pk, 0) AS goals_minus_pk,
  COALESCE(std.pens_made, 0)      AS pens_made,
  COALESCE(std.pens_att, 0)       AS pens_att,
  COALESCE(std.cards_yellow, 0)   AS cards_yellow,
  COALESCE(std.cards_red, 0)      AS cards_red,
  std.goals_per90,
  std.assists_per90,
  std.ga_per90,
  COALESCE(sh.shots, 0)           AS shots,
  COALESCE(sh.shots_on_target, 0) AS shots_on_target,
  sh.sot_pct,
  sh.shots_per90,
  sh.goals_per_shot,
  gk.saves,
  gk.save_pct,
  gk.clean_sheets,
  gk.goals_against,
  gk.goals_against_p90,
  gk.pens_saved,
  pt.minutes_pct,
  pt.starts_completed,
  pt.subs,
  pt.unused_sub,
  pt.points_per_match,
  pt.plus_minus,
  pt.plus_minus_per90,
  ms.fouls_committed,
  ms.fouls_drawn,
  ms.interceptions,
  ms.tackles_won,
  ms.crosses,
  ms.offsides,
  ms.pens_won,
  ms.own_goals,
  ms.second_yellow
FROM player_seasons ps
JOIN players  p   ON p.player_id  = ps.player_id
JOIN teams    t   ON t.team_id    = ps.team_id
JOIN leagues  l   ON l.league_id  = ps.league_id
JOIN seasons  s   ON s.season_id  = ps.season_id
LEFT JOIN positions          pos ON pos.position_id = ps.primary_position
LEFT JOIN nations            n   ON n.nation_id     = p.nation_id
LEFT JOIN stats_standard     std ON std.player_season_id = ps.player_season_id
LEFT JOIN stats_shooting     sh  ON sh.player_season_id  = ps.player_season_id
LEFT JOIN stats_keeper       gk  ON gk.player_season_id  = ps.player_season_id
LEFT JOIN stats_playing_time pt  ON pt.player_season_id  = ps.player_season_id
LEFT JOIN stats_misc         ms  ON ms.player_season_id  = ps.player_season_id;

-- ---------------------------------------------------------------------
-- Unpivots the scoring-relevant statistics into (stat_key, value) pairs.
-- This is what makes the fantasy formula data-driven: adding a new
-- scoring rule means inserting a row in fantasy_scoring_rules and adding
-- one UNION branch here, never editing application code.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fantasy_stat_facts AS
SELECT ps.player_season_id, ps.primary_position AS position_id,
       'matches_played' AS stat_key, COALESCE(std.matches_played, pt.matches_played, 0) AS value
  FROM player_seasons ps
  LEFT JOIN stats_standard std ON std.player_season_id = ps.player_season_id
  LEFT JOIN stats_playing_time pt ON pt.player_season_id = ps.player_season_id
UNION ALL
SELECT ps.player_season_id, ps.primary_position, 'starts', COALESCE(std.starts, pt.starts, 0)
  FROM player_seasons ps
  LEFT JOIN stats_standard std ON std.player_season_id = ps.player_season_id
  LEFT JOIN stats_playing_time pt ON pt.player_season_id = ps.player_season_id
UNION ALL
SELECT player_season_id, ps.primary_position, 'goals', COALESCE(goals, 0)
  FROM stats_standard JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'assists', COALESCE(assists, 0)
  FROM stats_standard JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'pens_missed',
       GREATEST(COALESCE(pens_att, 0) - COALESCE(pens_made, 0), 0)
  FROM stats_standard JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'cards_yellow', COALESCE(cards_yellow, 0)
  FROM stats_standard JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'cards_red', COALESCE(cards_red, 0)
  FROM stats_standard JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'clean_sheets', COALESCE(clean_sheets, 0)
  FROM stats_keeper JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'saves', COALESCE(saves, 0)
  FROM stats_keeper JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'goals_against', COALESCE(goals_against, 0)
  FROM stats_keeper JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'pens_saved', COALESCE(pens_saved, 0)
  FROM stats_keeper JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'own_goals', COALESCE(own_goals, 0)
  FROM stats_misc JOIN player_seasons ps USING (player_season_id)
UNION ALL
SELECT player_season_id, ps.primary_position, 'pens_won', COALESCE(pens_won, 0)
  FROM stats_misc JOIN player_seasons ps USING (player_season_id);
