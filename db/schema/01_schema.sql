-- =====================================================================
-- ScoutLens - Football Scouting & Fantasy Analytics Database
-- Schema definition (MySQL 8.0 / MariaDB 10.6+)
--
-- Source data : FBref "Big 5 European Leagues" player statistics,
--               seasons 2020-2021 .. 2025-2026 (21,100 player-season rows)
-- Design notes: The raw CSV is one wide, denormalised table of 85 columns.
--               It is decomposed here into 3NF: shared dimensions
--               (league / season / nation / team / position / player), a
--               central PLAYER_SEASON fact row, and one table per FBref
--               stat category in a strict 1:1 extension relationship.
-- =====================================================================

DROP DATABASE IF EXISTS scoutlens;
CREATE DATABASE scoutlens
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE scoutlens;

-- ---------------------------------------------------------------------
-- 1. DIMENSION TABLES
-- ---------------------------------------------------------------------

-- The five "Big 5" competitions. `fbref_code` keeps the raw CSV value
-- ("eng Premier League") so re-imports can match without re-cleaning.
CREATE TABLE leagues (
  league_id     TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fbref_code    VARCHAR(40)  NOT NULL,
  name          VARCHAR(40)  NOT NULL,
  country_code  CHAR(3)      NOT NULL,
  country_name  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (league_id),
  UNIQUE KEY uq_leagues_fbref_code (fbref_code),
  UNIQUE KEY uq_leagues_name (name)
) ENGINE=InnoDB;

-- A season is stored as its FBref label plus derived integer years so
-- that chronological ordering never depends on string sorting.
CREATE TABLE seasons (
  season_id     TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label         CHAR(9)      NOT NULL,        -- '2024-2025'
  start_year    SMALLINT UNSIGNED NOT NULL,
  end_year      SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (season_id),
  UNIQUE KEY uq_seasons_label (label),
  KEY ix_seasons_start_year (start_year)
) ENGINE=InnoDB;

-- FBref writes nationality as "ar ARG": a lowercase 2-letter flag code
-- followed by the 3-letter national-team code. Both are preserved.
CREATE TABLE nations (
  nation_id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fbref_code    VARCHAR(12)  NOT NULL,        -- 'ar ARG'
  flag_code     CHAR(2)      NOT NULL,        -- 'ar'  (ISO-3166-1 alpha-2)
  code          CHAR(3)      NOT NULL,        -- 'ARG' (FIFA/IOC style)
  PRIMARY KEY (nation_id),
  UNIQUE KEY uq_nations_fbref_code (fbref_code),
  KEY ix_nations_code (code)
) ENGINE=InnoDB;

-- Positions are stored atomically (GK/DF/MF/FW). A player listed as
-- "MF,FW" gets one row per position in player_season_positions.
CREATE TABLE positions (
  position_id   TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          CHAR(2)      NOT NULL,
  name          VARCHAR(20)  NOT NULL,
  sort_order    TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (position_id),
  UNIQUE KEY uq_positions_code (code)
) ENGINE=InnoDB;

-- Clubs. A club's league is NOT stored here: promotion / relegation and
-- the Big-5 scope mean the same club appears in different competitions
-- in different seasons, so that fact belongs on player_seasons.
CREATE TABLE teams (
  team_id       SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(60)  NOT NULL,
  PRIMARY KEY (team_id),
  UNIQUE KEY uq_teams_name (name)
) ENGINE=InnoDB;

-- Player identity. Name alone is NOT unique in this dataset (49 names are
-- shared by two different people), so identity is (name, born_year).
-- born_year is nullable, hence the generated column to keep the unique
-- key usable for the 16 rows with an unknown birth year.
CREATE TABLE players (
  player_id     MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(80)  NOT NULL,
  born_year     SMALLINT UNSIGNED NULL,
  nation_id     SMALLINT UNSIGNED NULL,
  born_key      SMALLINT UNSIGNED AS (IFNULL(born_year, 0)) STORED,
  PRIMARY KEY (player_id),
  UNIQUE KEY uq_players_identity (full_name, born_key),
  KEY ix_players_name (full_name),
  KEY ix_players_nation (nation_id),
  CONSTRAINT fk_players_nation FOREIGN KEY (nation_id)
    REFERENCES nations (nation_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. CENTRAL FACT TABLE
-- ---------------------------------------------------------------------

-- One row per player per club per season. A mid-season transfer produces
-- two rows (same player, same season, different team) - this is the
-- dataset's real grain and the unique key reflects it.
CREATE TABLE player_seasons (
  player_season_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id        MEDIUMINT UNSIGNED NOT NULL,
  team_id          SMALLINT UNSIGNED NOT NULL,
  league_id        TINYINT UNSIGNED  NOT NULL,
  season_id        TINYINT UNSIGNED  NOT NULL,
  -- Age as reported by FBref: either '21-023' (years-days) or '21.0'.
  -- Split so it can be filtered numerically.
  age_years        TINYINT UNSIGNED NULL,
  age_days         SMALLINT UNSIGNED NULL,
  primary_position TINYINT UNSIGNED NULL,
  fbref_rank       SMALLINT UNSIGNED NULL,
  PRIMARY KEY (player_season_id),
  UNIQUE KEY uq_player_team_season (player_id, team_id, season_id),
  KEY ix_ps_season_league (season_id, league_id),
  KEY ix_ps_team_season (team_id, season_id),
  KEY ix_ps_player (player_id),
  KEY ix_ps_position (primary_position),
  KEY ix_ps_age (age_years),
  CONSTRAINT fk_ps_player FOREIGN KEY (player_id)
    REFERENCES players (player_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ps_team FOREIGN KEY (team_id)
    REFERENCES teams (team_id) ON UPDATE CASCADE,
  CONSTRAINT fk_ps_league FOREIGN KEY (league_id)
    REFERENCES leagues (league_id) ON UPDATE CASCADE,
  CONSTRAINT fk_ps_season FOREIGN KEY (season_id)
    REFERENCES seasons (season_id) ON UPDATE CASCADE,
  CONSTRAINT fk_ps_position FOREIGN KEY (primary_position)
    REFERENCES positions (position_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- Resolves the multi-valued "MF,FW" attribute into 1NF.
CREATE TABLE player_season_positions (
  player_season_id INT UNSIGNED NOT NULL,
  position_id      TINYINT UNSIGNED NOT NULL,
  is_primary       TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (player_season_id, position_id),
  KEY ix_psp_position (position_id),
  CONSTRAINT fk_psp_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE,
  CONSTRAINT fk_psp_position FOREIGN KEY (position_id)
    REFERENCES positions (position_id) ON UPDATE CASCADE
) ENGINE=InnoDB;
