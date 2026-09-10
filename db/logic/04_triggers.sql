-- =====================================================================
-- ScoutLens - triggers
--
-- Squad rules are enforced in the database so that they hold no matter
-- which client writes the row - the API, a migration, or MySQL Workbench.
-- =====================================================================

USE scoutlens;

DROP TRIGGER IF EXISTS trg_squad_players_before_insert;
DROP TRIGGER IF EXISTS trg_squad_players_before_update;

DELIMITER $$

-- A squad holds at most 15 players, at most one captain, and every player
-- must come from the season the squad was created for.
CREATE TRIGGER trg_squad_players_before_insert
BEFORE INSERT ON squad_players
FOR EACH ROW
BEGIN
  DECLARE v_count      SMALLINT;
  DECLARE v_captains   SMALLINT;
  DECLARE v_squad_season TINYINT UNSIGNED;
  DECLARE v_player_season TINYINT UNSIGNED;

  SELECT COUNT(*) INTO v_count
    FROM squad_players WHERE squad_id = NEW.squad_id;
  IF v_count >= 15 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Squad is full: a squad may contain at most 15 players.';
  END IF;

  IF NEW.is_captain = 1 THEN
    SELECT COUNT(*) INTO v_captains
      FROM squad_players WHERE squad_id = NEW.squad_id AND is_captain = 1;
    IF v_captains >= 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Squad already has a captain.';
    END IF;
  END IF;

  SELECT season_id INTO v_squad_season FROM squads WHERE squad_id = NEW.squad_id;
  SELECT season_id INTO v_player_season
    FROM player_seasons WHERE player_season_id = NEW.player_season_id;
  IF v_squad_season <> v_player_season THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Player-season does not belong to this squad''s season.';
  END IF;
END$$

-- Promoting a second captain via UPDATE must fail the same way.
CREATE TRIGGER trg_squad_players_before_update
BEFORE UPDATE ON squad_players
FOR EACH ROW
BEGIN
  DECLARE v_captains SMALLINT;
  IF NEW.is_captain = 1 AND OLD.is_captain = 0 THEN
    SELECT COUNT(*) INTO v_captains
      FROM squad_players
     WHERE squad_id = NEW.squad_id AND is_captain = 1
       AND player_season_id <> NEW.player_season_id;
    IF v_captains >= 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Squad already has a captain.';
    END IF;
  END IF;
END$$

DELIMITER ;
