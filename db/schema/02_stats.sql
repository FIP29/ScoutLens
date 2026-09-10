-- =====================================================================
-- ScoutLens - statistic category tables
--
-- Each table below is a 1:1 optional extension of player_seasons, mirroring
-- one FBref export (Standard / Shooting / Keeper / Playing Time / Misc).
-- Splitting them keeps the fact table narrow and lets a query touch only
-- the categories it needs - a goalkeeper query never scans shooting data.
-- The PK is also the FK, which enforces the 1:1 cardinality.
-- =====================================================================

USE scoutlens;

-- --------------------------------------------------------------
-- Standard: appearances, goals, assists, cards, and the per-90 rates
-- --------------------------------------------------------------
CREATE TABLE stats_standard (
  player_season_id INT UNSIGNED NOT NULL,
  matches_played   SMALLINT UNSIGNED NULL,
  starts           SMALLINT UNSIGNED NULL,
  minutes          SMALLINT UNSIGNED NULL,
  nineties         DECIMAL(5,1)  NULL,
  goals            SMALLINT UNSIGNED NULL,
  assists          SMALLINT UNSIGNED NULL,
  goals_assists    SMALLINT UNSIGNED NULL,
  goals_minus_pk   SMALLINT UNSIGNED NULL,
  pens_made        SMALLINT UNSIGNED NULL,
  pens_att         SMALLINT UNSIGNED NULL,
  cards_yellow     SMALLINT UNSIGNED NULL,
  cards_red        SMALLINT UNSIGNED NULL,
  goals_per90      DECIMAL(5,2) NULL,
  assists_per90    DECIMAL(5,2) NULL,
  ga_per90         DECIMAL(5,2) NULL,
  g_minus_pk_per90 DECIMAL(5,2) NULL,
  ga_minus_pk_per90 DECIMAL(5,2) NULL,
  PRIMARY KEY (player_season_id),
  KEY ix_std_goals (goals),
  KEY ix_std_assists (assists),
  KEY ix_std_minutes (minutes),
  CONSTRAINT fk_std_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------
-- Shooting: volume and accuracy
-- --------------------------------------------------------------
CREATE TABLE stats_shooting (
  player_season_id INT UNSIGNED NOT NULL,
  shots            SMALLINT UNSIGNED NULL,
  shots_on_target  SMALLINT UNSIGNED NULL,
  sot_pct          DECIMAL(5,2) NULL,
  shots_per90      DECIMAL(5,2) NULL,
  sot_per90        DECIMAL(5,2) NULL,
  goals_per_shot   DECIMAL(5,2) NULL,
  goals_per_sot    DECIMAL(5,2) NULL,
  PRIMARY KEY (player_season_id),
  KEY ix_sh_shots (shots),
  CONSTRAINT fk_sh_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------
-- Keeper: only populated for goalkeepers who actually played
-- --------------------------------------------------------------
CREATE TABLE stats_keeper (
  player_season_id INT UNSIGNED NOT NULL,
  matches_played   SMALLINT UNSIGNED NULL,
  starts           SMALLINT UNSIGNED NULL,
  minutes          SMALLINT UNSIGNED NULL,
  nineties         DECIMAL(5,1) NULL,
  goals_against    SMALLINT UNSIGNED NULL,
  goals_against_p90 DECIMAL(5,2) NULL,
  shots_on_target_against SMALLINT UNSIGNED NULL,
  saves            SMALLINT UNSIGNED NULL,
  save_pct         DECIMAL(5,2) NULL,
  wins             SMALLINT UNSIGNED NULL,
  draws            SMALLINT UNSIGNED NULL,
  losses           SMALLINT UNSIGNED NULL,
  clean_sheets     SMALLINT UNSIGNED NULL,
  clean_sheet_pct  DECIMAL(5,2) NULL,
  pens_att_against SMALLINT UNSIGNED NULL,
  pens_allowed     SMALLINT UNSIGNED NULL,
  pens_saved       SMALLINT UNSIGNED NULL,
  pens_missed      SMALLINT UNSIGNED NULL,
  pen_save_pct     DECIMAL(5,2) NULL,
  PRIMARY KEY (player_season_id),
  KEY ix_gk_cs (clean_sheets),
  KEY ix_gk_saves (saves),
  CONSTRAINT fk_gk_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------
-- Playing time: rotation profile and team-success-on-pitch metrics.
-- This is the only category present for the ~3,950 fringe players who
-- have no Standard row at all (unused substitutes, 0-minute squad members).
-- --------------------------------------------------------------
CREATE TABLE stats_playing_time (
  player_season_id INT UNSIGNED NOT NULL,
  matches_played   SMALLINT UNSIGNED NULL,
  minutes_per_mp   DECIMAL(6,1) NULL,
  minutes_pct      DECIMAL(5,1) NULL,
  nineties         DECIMAL(5,1) NULL,
  starts           SMALLINT UNSIGNED NULL,
  minutes_per_start DECIMAL(6,1) NULL,
  starts_completed SMALLINT UNSIGNED NULL,
  subs             SMALLINT UNSIGNED NULL,
  minutes_per_sub  DECIMAL(6,1) NULL,
  unused_sub       SMALLINT UNSIGNED NULL,
  points_per_match DECIMAL(4,2) NULL,
  team_goals_on    SMALLINT UNSIGNED NULL,
  team_goals_against_on SMALLINT UNSIGNED NULL,
  plus_minus       SMALLINT NULL,
  plus_minus_per90 DECIMAL(6,2) NULL,
  on_off           DECIMAL(6,2) NULL,
  PRIMARY KEY (player_season_id),
  KEY ix_pt_minpct (minutes_pct),
  CONSTRAINT fk_pt_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------
-- Misc: discipline, aerial/defensive odds and ends
-- --------------------------------------------------------------
CREATE TABLE stats_misc (
  player_season_id INT UNSIGNED NOT NULL,
  second_yellow    SMALLINT UNSIGNED NULL,
  fouls_committed  SMALLINT UNSIGNED NULL,
  fouls_drawn      SMALLINT UNSIGNED NULL,
  offsides         SMALLINT UNSIGNED NULL,
  crosses          SMALLINT UNSIGNED NULL,
  interceptions    SMALLINT UNSIGNED NULL,
  tackles_won      SMALLINT UNSIGNED NULL,
  pens_won         SMALLINT UNSIGNED NULL,
  own_goals        SMALLINT UNSIGNED NULL,
  PRIMARY KEY (player_season_id),
  CONSTRAINT fk_misc_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;
