-- =====================================================================
-- ScoutLens - routines used by the admin player editor
-- =====================================================================

USE scoutlens;

DROP PROCEDURE IF EXISTS sp_recalculate_player_season_points;

DELIMITER $$

-- ---------------------------------------------------------------------
-- Rescores ONE player-season under every ruleset.
--
-- fantasy_points is a materialised table, so when an admin edits a
-- player's goals or minutes the stored score goes stale. The full
-- sp_recalculate_fantasy_points rebuilds all 21,100 rows (a few seconds),
-- which is far too slow to run on every save. This does the same
-- arithmetic for a single row.
--
-- The rule-precedence logic is identical to the full procedure: a
-- position-specific rule beats the generic (position_id IS NULL) rule for
-- the same stat, with <=> as the NULL-safe comparison.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_recalculate_player_season_points(IN p_player_season_id INT UNSIGNED)
BEGIN
  DELETE FROM fantasy_points WHERE player_season_id = p_player_season_id;

  INSERT INTO fantasy_points (player_season_id, ruleset_id, total_points,
      points_per90, points_per_match, attack_points, defence_points, discipline_points)
  SELECT
    scored.player_season_id,
    scored.ruleset_id,
    ROUND(SUM(scored.points), 2),
    IFNULL(ROUND(SUM(scored.points) / NULLIF(vps.nineties, 0), 2), 0),
    IFNULL(ROUND(SUM(scored.points) / NULLIF(vps.matches_played, 0), 2), 0),
    ROUND(SUM(CASE WHEN scored.category = 'attack'     THEN scored.points ELSE 0 END), 2),
    ROUND(SUM(CASE WHEN scored.category = 'defence'    THEN scored.points ELSE 0 END), 2),
    ROUND(SUM(CASE WHEN scored.category = 'discipline' THEN scored.points ELSE 0 END), 2)
  FROM (
    SELECT f.player_season_id, r.ruleset_id, r.category,
           FLOOR(f.value / r.unit) * r.points AS points
    FROM v_fantasy_stat_facts f
    JOIN fantasy_scoring_rules r
      ON  r.stat_key = f.stat_key
      AND (r.position_id = f.position_id OR r.position_id IS NULL)
    WHERE f.player_season_id = p_player_season_id
      AND (r.position_id <=> f.position_id
           OR NOT EXISTS (
                SELECT 1 FROM fantasy_scoring_rules r2
                 WHERE r2.ruleset_id  = r.ruleset_id
                   AND r2.stat_key    = f.stat_key
                   AND r2.position_id = f.position_id))
  ) AS scored
  JOIN v_player_season vps ON vps.player_season_id = scored.player_season_id
  GROUP BY scored.player_season_id, scored.ruleset_id, vps.nineties, vps.matches_played;
END$$

DELIMITER ;
