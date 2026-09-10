-- =====================================================================
-- ScoutLens - fantasy scoring rulesets (reference data)
--
-- Scoring is deliberately stored as rows, not hard-coded. Changing how
-- the game rewards a clean sheet is an UPDATE here followed by
-- CALL sp_recalculate_fantasy_points() - no application redeploy.
--
-- NOTE on clean sheets: the FBref exports only carry clean-sheet counts
-- for goalkeepers, so the DEF/MF clean-sheet rules below are defined for
-- completeness and score zero until team-level match data is added.
-- =====================================================================

USE scoutlens;

DELETE FROM fantasy_scoring_rules;
DELETE FROM fantasy_rulesets;

INSERT INTO fantasy_rulesets (ruleset_id, name, description, is_active) VALUES
  (1, 'Classic',      'Fantasy Premier League style scoring adapted to season totals.', 1),
  (2, 'Attack Heavy', 'Rewards goal involvement far more than defensive output.',       0);

-- Helper: resolve position codes to ids without hard-coding them.
SET @GK := (SELECT position_id FROM positions WHERE code = 'GK');
SET @DF := (SELECT position_id FROM positions WHERE code = 'DF');
SET @MF := (SELECT position_id FROM positions WHERE code = 'MF');
SET @FW := (SELECT position_id FROM positions WHERE code = 'FW');

-- ---------------- Ruleset 1: Classic ----------------
INSERT INTO fantasy_scoring_rules
  (ruleset_id, stat_key, position_id, points, unit, category, description) VALUES
  -- Appearances. Season totals have no per-match minute splits, so a
  -- start is treated as the "played 60+ minutes" bonus.
  (1, 'matches_played', NULL, 1.00, 1, 'appearance', '1 pt per appearance'),
  (1, 'starts',         NULL, 1.00, 1, 'appearance', '1 extra pt per start (60+ min proxy)'),

  -- Goals are worth more from deeper positions.
  (1, 'goals', @GK, 6.00, 1, 'attack', '6 pts per goal (GK)'),
  (1, 'goals', @DF, 6.00, 1, 'attack', '6 pts per goal (DF)'),
  (1, 'goals', @MF, 5.00, 1, 'attack', '5 pts per goal (MF)'),
  (1, 'goals', @FW, 4.00, 1, 'attack', '4 pts per goal (FW)'),
  (1, 'assists',   NULL,  3.00, 1, 'attack', '3 pts per assist'),
  (1, 'pens_won',  NULL,  1.00, 1, 'attack', '1 pt per penalty won'),

  -- Goalkeeping and defence.
  (1, 'clean_sheets', @GK, 4.00, 1, 'defence', '4 pts per clean sheet (GK)'),
  (1, 'clean_sheets', @DF, 4.00, 1, 'defence', '4 pts per clean sheet (DF)'),
  (1, 'clean_sheets', @MF, 1.00, 1, 'defence', '1 pt per clean sheet (MF)'),
  (1, 'saves',        @GK, 1.00, 3, 'defence', '1 pt per 3 saves'),
  (1, 'pens_saved',   @GK, 5.00, 1, 'defence', '5 pts per penalty saved'),
  (1, 'goals_against',@GK, -1.00, 2, 'defence', '-1 pt per 2 goals conceded'),

  -- Discipline.
  (1, 'cards_yellow', NULL, -1.00, 1, 'discipline', '-1 pt per yellow card'),
  (1, 'cards_red',    NULL, -3.00, 1, 'discipline', '-3 pts per red card'),
  (1, 'own_goals',    NULL, -2.00, 1, 'discipline', '-2 pts per own goal'),
  (1, 'pens_missed',  NULL, -2.00, 1, 'discipline', '-2 pts per penalty missed');

-- ---------------- Ruleset 2: Attack Heavy ----------------
INSERT INTO fantasy_scoring_rules
  (ruleset_id, stat_key, position_id, points, unit, category, description) VALUES
  (2, 'matches_played', NULL, 0.50, 1, 'appearance', '0.5 pt per appearance'),
  (2, 'goals',          NULL, 8.00, 1, 'attack',     '8 pts per goal, any position'),
  (2, 'assists',        NULL, 5.00, 1, 'attack',     '5 pts per assist'),
  (2, 'pens_won',       NULL, 2.00, 1, 'attack',     '2 pts per penalty won'),
  (2, 'clean_sheets',   @GK,  2.00, 1, 'defence',    '2 pts per clean sheet (GK)'),
  (2, 'saves',          @GK,  1.00, 4, 'defence',    '1 pt per 4 saves'),
  (2, 'cards_red',      NULL, -2.00, 1, 'discipline','-2 pts per red card'),
  (2, 'own_goals',      NULL, -2.00, 1, 'discipline','-2 pts per own goal');
