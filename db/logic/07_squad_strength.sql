-- =====================================================================
-- ScoutLens - squad strength and head-to-head match simulation
--
-- WHAT THIS IS
--   A rating model that turns a saved squad's player statistics into two
--   indices - attack and defence - and then converts a pair of those
--   into match outcome probabilities using a Poisson model.
--
-- WHAT THIS IS NOT
--   A prediction of a real match. It reads season aggregates, not form,
--   fitness, tactics, home advantage or fixtures. Treat the output as
--   "which of these two squads is stronger, and by roughly how much",
--   not as a betting model.
--
-- WHY POISSON
--   Goals in football are rare, independent-ish events in fixed time,
--   which is what the Poisson distribution describes. It is the standard
--   textbook model for football scorelines and, unlike a black box, every
--   step below can be read and checked by hand.
-- =====================================================================

USE scoutlens;

-- ---------------------------------------------------------------------
-- Per-player contribution, expressed per 90 minutes so that a player
-- with 900 minutes is comparable with one who played 3,000.
--
--   attack_per90  goals plus assists, assists weighted at 0.7 because
--                 creating a goal is worth less than scoring it
--   conceded_per90  goals the team let in while this player was on the
--                 pitch - a blunt but honest defensive signal, and the
--                 only team-level defensive data in the dataset
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_player_strength AS
SELECT
  ps.player_season_id,
  ps.season_id,
  pos.code AS position_code,
  COALESCE(std.minutes, 0) AS minutes,
  NULLIF(COALESCE(std.nineties, pt.nineties, 0), 0) AS nineties,

  -- Attacking output per 90.
  ROUND(
    (COALESCE(std.goals, 0) + 0.7 * COALESCE(std.assists, 0))
    / NULLIF(COALESCE(std.nineties, pt.nineties, 0), 0), 4) AS attack_per90,

  -- Goals conceded per 90 while on the pitch.
  ROUND(
    COALESCE(pt.team_goals_against_on, 0)
    / NULLIF(COALESCE(pt.nineties, std.nineties, 0), 0), 4) AS conceded_per90,

  -- Defensive actions per 90 - a small refinement on the above.
  ROUND(
    (COALESCE(ms.tackles_won, 0) + COALESCE(ms.interceptions, 0))
    / NULLIF(COALESCE(std.nineties, pt.nineties, 0), 0), 4) AS def_actions_per90,

  -- Goalkeeping: save percentage, only meaningful for keepers.
  gk.save_pct,
  gk.goals_against_p90
FROM player_seasons ps
LEFT JOIN positions          pos ON pos.position_id     = ps.primary_position
LEFT JOIN stats_standard     std ON std.player_season_id = ps.player_season_id
LEFT JOIN stats_playing_time pt  ON pt.player_season_id  = ps.player_season_id
LEFT JOIN stats_misc         ms  ON ms.player_season_id  = ps.player_season_id
LEFT JOIN stats_keeper       gk  ON gk.player_season_id  = ps.player_season_id;

-- ---------------------------------------------------------------------
-- League baselines, computed from the data rather than hard-coded, so
-- the model stays calibrated if the dataset is refreshed.
--
-- Restricted to players with 900+ minutes: fringe players with 30 minutes
-- produce wild per-90 rates that would distort the average.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_league_baseline AS
SELECT
  ROUND(AVG(attack_per90), 4)   AS avg_attack_per90,
  ROUND(AVG(conceded_per90), 4) AS avg_conceded_per90,
  ROUND(AVG(save_pct), 2)       AS avg_save_pct
FROM v_player_strength
WHERE minutes >= 900;

-- ---------------------------------------------------------------------
-- Squad-level ratings. Bench players are excluded: only the starting XI
-- is rated, which is what would actually take the field.
--
-- Both indices are normalised so that a perfectly average XI scores 1.00:
--   attack_index   > 1 means the XI creates more than an average XI
--   defence_index  > 1 means the XI concedes more than average (worse)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_squad_strength AS
SELECT
  sq.squad_id,
  sq.name AS squad_name,
  sq.formation,
  sq.season_id,
  s.label AS season_label,
  COUNT(sp.player_season_id) AS starters,

  ROUND(AVG(vs.attack_per90), 4)   AS squad_attack_per90,
  ROUND(AVG(vs.conceded_per90), 4) AS squad_conceded_per90,

  ROUND(AVG(vs.attack_per90)   / NULLIF(b.avg_attack_per90, 0), 3)   AS attack_index,
  ROUND(AVG(vs.conceded_per90) / NULLIF(b.avg_conceded_per90, 0), 3) AS defence_index,

  ROUND(AVG(vs.def_actions_per90), 2) AS def_actions_per90,
  ROUND(AVG(vs.save_pct), 1)          AS keeper_save_pct,
  SUM(vs.minutes)                     AS total_minutes,
  ROUND(AVG(fp.total_points), 1)      AS avg_fantasy_points
FROM squads sq
JOIN seasons s          ON s.season_id = sq.season_id
JOIN squad_players sp   ON sp.squad_id = sq.squad_id AND sp.slot <> 'BENCH'
JOIN v_player_strength vs ON vs.player_season_id = sp.player_season_id
LEFT JOIN fantasy_points fp
       ON fp.player_season_id = sp.player_season_id
      AND fp.ruleset_id = fn_active_ruleset()
CROSS JOIN v_league_baseline b
GROUP BY sq.squad_id, sq.name, sq.formation, sq.season_id, s.label,
         b.avg_attack_per90, b.avg_conceded_per90;

-- ---------------------------------------------------------------------
-- Procedures
-- ---------------------------------------------------------------------

DROP PROCEDURE IF EXISTS sp_squad_strength;
DROP PROCEDURE IF EXISTS sp_compare_squads;
DROP PROCEDURE IF EXISTS sp_squad_scoreline_grid;

DELIMITER $$

-- Ratings for one squad, plus its per-player breakdown.
CREATE PROCEDURE sp_squad_strength(IN p_squad_id MEDIUMINT UNSIGNED)
BEGIN
  SELECT * FROM v_squad_strength WHERE squad_id = p_squad_id;
END$$

-- ---------------------------------------------------------------------
-- Head to head. Returns one row carrying both squads' ratings, the
-- expected goals for each, and the win/draw/loss probabilities.
--
-- Expected goals for A  =  base  x  A's attack index  x  B's defence index
--
-- `base` is the league's average goals conceded per team per 90, taken
-- from the data (about 1.39). So two perfectly average squads each get
-- an expectation of 1.39 goals, which is what actually happens in these
-- leagues - the model is anchored to reality rather than invented.
--
-- The probabilities come from a Poisson distribution over 0..8 goals:
--
--   P(k goals) = e^(-lambda) * lambda^k / k!
--
-- Every (i, j) scoreline pair is then summed into win, draw or loss.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_compare_squads(
  IN p_squad_a MEDIUMINT UNSIGNED,
  IN p_squad_b MEDIUMINT UNSIGNED)
BEGIN
  DECLARE v_base       DECIMAL(10,4);
  DECLARE v_lambda_a   DECIMAL(10,4);
  DECLARE v_lambda_b   DECIMAL(10,4);

  SELECT avg_conceded_per90 INTO v_base FROM v_league_baseline;

  -- Damping. A squad picked as eleven elite forwards can reach an attack
  -- index above 5, but no real team scores five times the league average:
  -- a striker cannot take every chance, and a pitch only holds one ball.
  -- Raising the index to a power below 1 keeps the ordering of squads
  -- intact while pulling extreme values back toward plausible scorelines.
  -- The exponents (0.60 attack, 0.80 defence) were chosen so that an
  -- average XI still yields exactly the league baseline, since 1^n = 1.
  SELECT
    LEAST(GREATEST(v_base * POW(a.attack_index, 0.60)
                          * POW(b.defence_index, 0.80), 0.15), 5.0),
    LEAST(GREATEST(v_base * POW(b.attack_index, 0.60)
                          * POW(a.defence_index, 0.80), 0.15), 5.0)
    INTO v_lambda_a, v_lambda_b
  FROM v_squad_strength a
  JOIN v_squad_strength b ON b.squad_id = p_squad_b
  WHERE a.squad_id = p_squad_a;

  -- Poisson probability mass for 0..8 goals, built with a recursive CTE
  -- so no numbers table is needed. `fact` carries the factorial.
  WITH RECURSIVE
  k_seq (k, fact) AS (
    -- The anchor row fixes the column type for the whole recursion, so
    -- the seed is cast wide: a bare 1.0 is inferred as DECIMAL(2,1) and
    -- the factorial overflows at 5! = 120.
    SELECT 0, CAST(1 AS DOUBLE)
    UNION ALL
    SELECT k + 1, fact * (k + 1) FROM k_seq WHERE k < 8
  ),
  pa AS (
    SELECT k, EXP(-v_lambda_a) * POW(v_lambda_a, k) / fact AS p FROM k_seq
  ),
  pb AS (
    SELECT k, EXP(-v_lambda_b) * POW(v_lambda_b, k) / fact AS p FROM k_seq
  ),
  grid AS (
    SELECT pa.k AS goals_a, pb.k AS goals_b, pa.p * pb.p AS p
    FROM pa CROSS JOIN pb
  )
  SELECT
    a.squad_id      AS squad_a_id,
    a.squad_name    AS squad_a_name,
    a.attack_index  AS squad_a_attack,
    a.defence_index AS squad_a_defence,
    a.keeper_save_pct AS squad_a_save_pct,
    a.avg_fantasy_points AS squad_a_form,
    a.starters      AS squad_a_starters,

    b.squad_id      AS squad_b_id,
    b.squad_name    AS squad_b_name,
    b.attack_index  AS squad_b_attack,
    b.defence_index AS squad_b_defence,
    b.keeper_save_pct AS squad_b_save_pct,
    b.avg_fantasy_points AS squad_b_form,
    b.starters      AS squad_b_starters,

    ROUND(v_lambda_a, 2) AS expected_goals_a,
    ROUND(v_lambda_b, 2) AS expected_goals_b,

    -- The grid stops at 8 goals, so a small tail of improbable scorelines
    -- is missing and the raw probabilities sum to slightly under 1.
    -- Dividing by the grid total renormalises them to exactly 100%.
    ROUND(100 * (SELECT SUM(p) FROM grid WHERE goals_a > goals_b)
              / (SELECT SUM(p) FROM grid), 1) AS pct_a_win,
    ROUND(100 * (SELECT SUM(p) FROM grid WHERE goals_a = goals_b)
              / (SELECT SUM(p) FROM grid), 1) AS pct_draw,
    ROUND(100 * (SELECT SUM(p) FROM grid WHERE goals_a < goals_b)
              / (SELECT SUM(p) FROM grid), 1) AS pct_b_win,

    (SELECT CONCAT(goals_a, '-', goals_b) FROM grid
      ORDER BY p DESC LIMIT 1) AS likeliest_score,
    ROUND(100 * (SELECT MAX(p) FROM grid)
              / (SELECT SUM(p) FROM grid), 1) AS likeliest_score_pct
  FROM v_squad_strength a
  JOIN v_squad_strength b ON b.squad_id = p_squad_b
  WHERE a.squad_id = p_squad_a;
END$$

-- The full scoreline probability grid, for charting the head-to-head.
CREATE PROCEDURE sp_squad_scoreline_grid(
  IN p_squad_a MEDIUMINT UNSIGNED,
  IN p_squad_b MEDIUMINT UNSIGNED)
BEGIN
  DECLARE v_base     DECIMAL(10,4);
  DECLARE v_lambda_a DECIMAL(10,4);
  DECLARE v_lambda_b DECIMAL(10,4);

  SELECT avg_conceded_per90 INTO v_base FROM v_league_baseline;

  -- Damping. A squad picked as eleven elite forwards can reach an attack
  -- index above 5, but no real team scores five times the league average:
  -- a striker cannot take every chance, and a pitch only holds one ball.
  -- Raising the index to a power below 1 keeps the ordering of squads
  -- intact while pulling extreme values back toward plausible scorelines.
  -- The exponents (0.60 attack, 0.80 defence) were chosen so that an
  -- average XI still yields exactly the league baseline, since 1^n = 1.
  SELECT
    LEAST(GREATEST(v_base * POW(a.attack_index, 0.60)
                          * POW(b.defence_index, 0.80), 0.15), 5.0),
    LEAST(GREATEST(v_base * POW(b.attack_index, 0.60)
                          * POW(a.defence_index, 0.80), 0.15), 5.0)
    INTO v_lambda_a, v_lambda_b
  FROM v_squad_strength a
  JOIN v_squad_strength b ON b.squad_id = p_squad_b
  WHERE a.squad_id = p_squad_a;

  WITH RECURSIVE
  k_seq (k, fact) AS (
    SELECT 0, CAST(1 AS DOUBLE)
    UNION ALL
    SELECT k + 1, fact * (k + 1) FROM k_seq WHERE k < 5
  )
  SELECT
    a.k AS goals_a,
    b.k AS goals_b,
    ROUND(100 *
      (EXP(-v_lambda_a) * POW(v_lambda_a, a.k) / a.fact) *
      (EXP(-v_lambda_b) * POW(v_lambda_b, b.k) / b.fact), 2) AS pct
  FROM k_seq a CROSS JOIN k_seq b
  ORDER BY a.k, b.k;
END$$

DELIMITER ;
