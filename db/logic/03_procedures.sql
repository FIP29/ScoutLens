-- =====================================================================
-- ScoutLens - stored procedures and functions
--
-- Anything the API would otherwise recompute in JavaScript on every
-- request lives here: fantasy scoring, trend series, head-to-head
-- comparison and squad projection.
-- =====================================================================

USE scoutlens;

DROP PROCEDURE IF EXISTS sp_recalculate_fantasy_points;
DROP PROCEDURE IF EXISTS sp_player_trend;
DROP PROCEDURE IF EXISTS sp_compare_players;
DROP PROCEDURE IF EXISTS sp_leaderboard;
DROP PROCEDURE IF EXISTS sp_squad_projection;
DROP PROCEDURE IF EXISTS sp_team_season_summary;
DROP FUNCTION  IF EXISTS fn_active_ruleset;

DELIMITER $$

-- Returns the id of the ruleset currently flagged active.
CREATE FUNCTION fn_active_ruleset() RETURNS TINYINT UNSIGNED
  READS SQL DATA
BEGIN
  DECLARE v_id TINYINT UNSIGNED;
  SELECT ruleset_id INTO v_id FROM fantasy_rulesets WHERE is_active = 1 LIMIT 1;
  RETURN IFNULL(v_id, 1);
END$$

-- ---------------------------------------------------------------------
-- Rebuilds the fantasy_points table for one ruleset by joining the
-- unpivoted stat facts to the scoring rules. Position-specific rules win
-- over the generic (position_id IS NULL) rule for the same stat_key.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_recalculate_fantasy_points(IN p_ruleset_id TINYINT UNSIGNED)
BEGIN
  DECLARE v_ruleset TINYINT UNSIGNED;
  SET v_ruleset = IFNULL(p_ruleset_id, fn_active_ruleset());

  DELETE FROM fantasy_points WHERE ruleset_id = v_ruleset;

  INSERT INTO fantasy_points (player_season_id, ruleset_id, total_points,
      points_per90, points_per_match, attack_points, defence_points, discipline_points)
  SELECT
    scored.player_season_id,
    v_ruleset,
    ROUND(SUM(scored.points), 2)                                   AS total_points,
    -- Fringe players can have zero minutes / zero appearances; the rate
    -- columns are NOT NULL, so an undefined rate is stored as 0.
    IFNULL(ROUND(SUM(scored.points) / NULLIF(vps.nineties, 0), 2), 0)       AS points_per90,
    IFNULL(ROUND(SUM(scored.points) / NULLIF(vps.matches_played, 0), 2), 0) AS points_per_match,
    ROUND(SUM(CASE WHEN scored.category = 'attack'     THEN scored.points ELSE 0 END), 2),
    ROUND(SUM(CASE WHEN scored.category = 'defence'    THEN scored.points ELSE 0 END), 2),
    ROUND(SUM(CASE WHEN scored.category = 'discipline' THEN scored.points ELSE 0 END), 2)
  FROM (
    SELECT
      f.player_season_id,
      r.category,
      FLOOR(f.value / r.unit) * r.points AS points
    FROM v_fantasy_stat_facts f
    JOIN fantasy_scoring_rules r
      ON  r.ruleset_id = v_ruleset
      AND r.stat_key   = f.stat_key
      AND (r.position_id = f.position_id OR r.position_id IS NULL)
    -- Keep only the most specific rule per (player-season, stat).
    WHERE r.position_id <=> f.position_id
       OR NOT EXISTS (
            SELECT 1 FROM fantasy_scoring_rules r2
             WHERE r2.ruleset_id  = v_ruleset
               AND r2.stat_key    = f.stat_key
               AND r2.position_id = f.position_id)
  ) AS scored
  JOIN v_player_season vps ON vps.player_season_id = scored.player_season_id
  GROUP BY scored.player_season_id, vps.nineties, vps.matches_played;
END$$

-- ---------------------------------------------------------------------
-- Season-by-season career line for one player, ordered chronologically.
-- Powers the trend charts on the player profile page.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_player_trend(IN p_player_id MEDIUMINT UNSIGNED)
BEGIN
  SELECT
    vps.season_label, vps.start_year, vps.team_name, vps.league_name,
    vps.position_code, vps.age_years, vps.matches_played, vps.starts,
    vps.minutes, vps.nineties, vps.goals, vps.assists, vps.goals_assists,
    vps.shots, vps.shots_on_target, vps.cards_yellow, vps.cards_red,
    vps.clean_sheets, vps.saves,
    ROUND(vps.goals   / NULLIF(vps.nineties, 0), 2) AS goals_per90,
    ROUND(vps.assists / NULLIF(vps.nineties, 0), 2) AS assists_per90,
    fp.total_points, fp.points_per90
  FROM v_player_season vps
  LEFT JOIN fantasy_points fp
    ON  fp.player_season_id = vps.player_season_id
    AND fp.ruleset_id       = fn_active_ruleset()
  WHERE vps.player_id = p_player_id
  ORDER BY vps.start_year, vps.team_name;
END$$

-- ---------------------------------------------------------------------
-- Head-to-head: returns both player-seasons side by side, one row each,
-- so the client renders a comparison table without a second round trip.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_compare_players(
  IN p_left INT UNSIGNED, IN p_right INT UNSIGNED)
BEGIN
  SELECT
    vps.*,
    fp.total_points, fp.points_per90, fp.attack_points,
    fp.defence_points, fp.discipline_points,
    CASE WHEN vps.player_season_id = p_left THEN 'left' ELSE 'right' END AS side
  FROM v_player_season vps
  LEFT JOIN fantasy_points fp
    ON  fp.player_season_id = vps.player_season_id
    AND fp.ruleset_id       = fn_active_ruleset()
  WHERE vps.player_season_id IN (p_left, p_right);
END$$

-- ---------------------------------------------------------------------
-- Top fantasy scorers, optionally narrowed by season / league / position.
-- NULL means "no filter" for every parameter.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_leaderboard(
  IN p_season_id   TINYINT UNSIGNED,
  IN p_league_id   TINYINT UNSIGNED,
  IN p_position    CHAR(2),
  IN p_min_minutes SMALLINT UNSIGNED,
  IN p_limit       SMALLINT UNSIGNED)
BEGIN
  -- LIMIT accepts a local variable but not an expression, hence the DECLARE.
  DECLARE v_limit SMALLINT UNSIGNED;
  SET v_limit = LEAST(GREATEST(IFNULL(p_limit, 50), 1), 500);

  SELECT
    vps.player_season_id, vps.player_id, vps.player_name, vps.team_name,
    vps.league_name, vps.season_label, vps.position_code, vps.nation_code,
    vps.age_years, vps.minutes, vps.matches_played,
    vps.goals, vps.assists, vps.clean_sheets, vps.saves,
    fp.total_points, fp.points_per90, fp.points_per_match,
    fp.attack_points, fp.defence_points, fp.discipline_points
  FROM fantasy_points fp
  JOIN v_player_season vps ON vps.player_season_id = fp.player_season_id
  WHERE fp.ruleset_id = fn_active_ruleset()
    AND (p_season_id   IS NULL OR vps.season_id     = p_season_id)
    AND (p_league_id   IS NULL OR vps.league_id     = p_league_id)
    AND (p_position    IS NULL OR vps.position_code = p_position)
    AND (p_min_minutes IS NULL OR vps.minutes      >= p_min_minutes)
  ORDER BY fp.total_points DESC, vps.minutes DESC
  LIMIT v_limit;
END$$

-- ---------------------------------------------------------------------
-- Projected points for a saved squad, captain counted double.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_squad_projection(IN p_squad_id MEDIUMINT UNSIGNED)
BEGIN
  SELECT
    sq.squad_id, sq.name AS squad_name, sq.formation, s.label AS season_label,
    COUNT(sp.player_season_id) AS squad_size,
    ROUND(SUM(CASE WHEN sp.slot = 'BENCH' THEN 0
                   ELSE fp.total_points * IF(sp.is_captain, 2, 1) END), 2) AS starting_points,
    ROUND(SUM(fp.total_points), 2) AS total_points_incl_bench
  FROM squads sq
  JOIN seasons s ON s.season_id = sq.season_id
  LEFT JOIN squad_players sp ON sp.squad_id = sq.squad_id
  LEFT JOIN fantasy_points fp
    ON  fp.player_season_id = sp.player_season_id
    AND fp.ruleset_id       = fn_active_ruleset()
  WHERE sq.squad_id = p_squad_id
  GROUP BY sq.squad_id, sq.name, sq.formation, s.label;
END$$

-- ---------------------------------------------------------------------
-- Squad-level aggregates for one club in one season.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_team_season_summary(
  IN p_team_id SMALLINT UNSIGNED, IN p_season_id TINYINT UNSIGNED)
BEGIN
  SELECT
    vps.team_name, vps.league_name, vps.season_label,
    COUNT(*)                       AS players_used,
    SUM(vps.goals)                 AS goals,
    SUM(vps.assists)               AS assists,
    SUM(vps.cards_yellow)          AS yellows,
    SUM(vps.cards_red)             AS reds,
    ROUND(AVG(NULLIF(vps.age_years, 0)), 1) AS avg_age,
    ROUND(AVG(NULLIF(vps.points_per_match, 0)), 2) AS avg_points_per_match,
    ROUND(SUM(fp.total_points), 2) AS fantasy_points
  FROM v_player_season vps
  LEFT JOIN fantasy_points fp
    ON  fp.player_season_id = vps.player_season_id
    AND fp.ruleset_id       = fn_active_ruleset()
  WHERE vps.team_id = p_team_id AND vps.season_id = p_season_id
  GROUP BY vps.team_name, vps.league_name, vps.season_label;
END$$

DELIMITER ;
