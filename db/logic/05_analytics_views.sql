-- =====================================================================
-- ScoutLens - analytics views used by the dashboard pages
-- =====================================================================

USE scoutlens;

-- Club-season aggregates, one row per team per season.
CREATE OR REPLACE VIEW v_team_season AS
SELECT
  vps.team_id, vps.team_name, vps.league_id, vps.league_name,
  vps.season_id, vps.season_label, vps.start_year,
  COUNT(*)                                AS players_used,
  SUM(vps.goals)                          AS goals,
  SUM(vps.assists)                        AS assists,
  SUM(vps.cards_yellow)                   AS yellows,
  SUM(vps.cards_red)                      AS reds,
  ROUND(AVG(NULLIF(vps.age_years, 0)), 1) AS avg_age,
  SUM(vps.minutes)                        AS total_minutes
FROM v_player_season vps
GROUP BY vps.team_id, vps.team_name, vps.league_id, vps.league_name,
         vps.season_id, vps.season_label, vps.start_year;

-- League-season totals, for the "state of the leagues" dashboard.
CREATE OR REPLACE VIEW v_league_season AS
SELECT
  vps.league_id, vps.league_name, vps.country_code,
  vps.season_id, vps.season_label, vps.start_year,
  COUNT(DISTINCT vps.team_id)             AS teams,
  COUNT(DISTINCT vps.player_id)           AS players,
  SUM(vps.goals)                          AS goals,
  SUM(vps.assists)                        AS assists,
  ROUND(AVG(NULLIF(vps.age_years, 0)), 1) AS avg_age,
  ROUND(SUM(vps.goals) / NULLIF(COUNT(DISTINCT vps.team_id), 0), 1) AS goals_per_team
FROM v_player_season vps
GROUP BY vps.league_id, vps.league_name, vps.country_code,
         vps.season_id, vps.season_label, vps.start_year;

-- Career totals per player across every club and season in the dataset.
CREATE OR REPLACE VIEW v_player_career AS
SELECT
  vps.player_id, vps.player_name, vps.nation_code, vps.born_year,
  COUNT(DISTINCT vps.season_id)  AS seasons_played,
  COUNT(DISTINCT vps.team_id)    AS clubs,
  MAX(vps.age_years)             AS latest_age,
  SUM(vps.matches_played)        AS matches_played,
  SUM(vps.minutes)               AS minutes,
  SUM(vps.goals)                 AS goals,
  SUM(vps.assists)               AS assists,
  SUM(vps.goals_assists)         AS goals_assists,
  ROUND(SUM(vps.goals) / NULLIF(SUM(vps.nineties), 0), 2)   AS goals_per90,
  ROUND(SUM(vps.assists) / NULLIF(SUM(vps.nineties), 0), 2) AS assists_per90,
  GROUP_CONCAT(DISTINCT vps.position_code ORDER BY vps.position_code SEPARATOR ',') AS positions,
  SUBSTRING_INDEX(GROUP_CONCAT(vps.team_name ORDER BY vps.start_year DESC), ',', 1) AS latest_team
FROM v_player_season vps
GROUP BY vps.player_id, vps.player_name, vps.nation_code, vps.born_year;

-- Season-over-season deltas: how much a player improved on the previous
-- season. Computed with a window function so the API never has to
-- fetch two seasons and subtract them in JavaScript.
CREATE OR REPLACE VIEW v_player_progression AS
SELECT
  player_id, player_name, season_id, season_label, start_year,
  team_name, league_name, position_code, age_years,
  minutes, goals, assists, goals_assists,
  goals   - LAG(goals)   OVER w AS goals_delta,
  assists - LAG(assists) OVER w AS assists_delta,
  minutes - LAG(minutes) OVER w AS minutes_delta,
  LAG(team_name) OVER w         AS previous_team
FROM v_player_season
WINDOW w AS (PARTITION BY player_id ORDER BY start_year);
