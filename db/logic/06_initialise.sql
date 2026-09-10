-- =====================================================================
-- ScoutLens - final initialisation step.
--
-- Runs after the views, rulesets, procedures and triggers are in place:
-- seeds the demo scout account and scores every player-season under the
-- active ruleset so the app has data on first load.
-- =====================================================================

USE scoutlens;

INSERT INTO users (user_id, username, display_name)
     VALUES (1, 'demo', 'Demo Scout')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Score both rulesets so switching between them in the UI is instant.
CALL sp_recalculate_fantasy_points(1);
CALL sp_recalculate_fantasy_points(2);
