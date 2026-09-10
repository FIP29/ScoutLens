-- =====================================================================
-- ScoutLens - fantasy scoring configuration + application tables
--
-- The fantasy points formula is DATA, not code: it lives in
-- fantasy_scoring_rules so the ruleset can be re-tuned with an UPDATE
-- instead of a redeploy, and so every leaderboard in the app is derived
-- from the same single source of truth.
-- =====================================================================

USE scoutlens;

-- A named ruleset (Classic, Attack-heavy, ...). Exactly one is active.
CREATE TABLE fantasy_rulesets (
  ruleset_id   TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(40) NOT NULL,
  description  VARCHAR(255) NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ruleset_id),
  UNIQUE KEY uq_ruleset_name (name)
) ENGINE=InnoDB;

-- Points per unit of a stat, optionally scoped to a position
-- (a clean sheet is worth more to a GK than to a forward).
-- position_id NULL = the rule applies to every position.
CREATE TABLE fantasy_scoring_rules (
  rule_id      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ruleset_id   TINYINT UNSIGNED NOT NULL,
  stat_key     VARCHAR(32) NOT NULL,   -- 'goals', 'assists', 'clean_sheets', ...
  position_id  TINYINT UNSIGNED NULL,  -- NULL = applies to every position
  points       DECIMAL(6,2) NOT NULL,  -- points awarded per `unit` of the stat
  unit         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  category     ENUM('appearance','attack','defence','discipline') NOT NULL
                 DEFAULT 'attack',     -- drives the points breakdown in the UI
  description  VARCHAR(120) NULL,
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_rule (ruleset_id, stat_key, position_id),
  KEY ix_rule_position (position_id),
  CONSTRAINT fk_rule_ruleset FOREIGN KEY (ruleset_id)
    REFERENCES fantasy_rulesets (ruleset_id) ON DELETE CASCADE,
  CONSTRAINT fk_rule_position FOREIGN KEY (position_id)
    REFERENCES positions (position_id) ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Materialised fantasy points per player-season, refreshed by
-- sp_recalculate_fantasy_points(). Kept as a real table rather than a view
-- because every leaderboard, filter and squad projection sorts on it;
-- recomputing the full formula per query is measurably slower.
CREATE TABLE fantasy_points (
  player_season_id INT UNSIGNED NOT NULL,
  ruleset_id       TINYINT UNSIGNED NOT NULL,
  total_points     DECIMAL(8,2) NOT NULL DEFAULT 0,
  points_per90     DECIMAL(6,2) NOT NULL DEFAULT 0,
  points_per_match DECIMAL(6,2) NOT NULL DEFAULT 0,
  attack_points    DECIMAL(8,2) NOT NULL DEFAULT 0,
  defence_points   DECIMAL(8,2) NOT NULL DEFAULT 0,
  discipline_points DECIMAL(8,2) NOT NULL DEFAULT 0,
  calculated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_season_id, ruleset_id),
  KEY ix_fp_total (ruleset_id, total_points DESC),
  KEY ix_fp_per90 (ruleset_id, points_per90 DESC),
  CONSTRAINT fk_fp_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE,
  CONSTRAINT fk_fp_ruleset FOREIGN KEY (ruleset_id)
    REFERENCES fantasy_rulesets (ruleset_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Application tables - the read/write half of the app
-- ---------------------------------------------------------------------

CREATE TABLE users (
  user_id      MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username     VARCHAR(40) NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

-- A scout's shortlist of players to track.
CREATE TABLE shortlists (
  shortlist_id MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      MEDIUMINT UNSIGNED NOT NULL,
  name         VARCHAR(60) NOT NULL,
  notes        VARCHAR(500) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shortlist_id),
  UNIQUE KEY uq_shortlist_per_user (user_id, name),
  CONSTRAINT fk_shortlist_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE shortlist_entries (
  shortlist_id     MEDIUMINT UNSIGNED NOT NULL,
  player_season_id INT UNSIGNED NOT NULL,
  rating           TINYINT UNSIGNED NULL,   -- scout's own 1-5 rating
  note             VARCHAR(300) NULL,
  added_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shortlist_id, player_season_id),
  KEY ix_se_ps (player_season_id),
  CONSTRAINT fk_se_shortlist FOREIGN KEY (shortlist_id)
    REFERENCES shortlists (shortlist_id) ON DELETE CASCADE,
  CONSTRAINT fk_se_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE,
  CONSTRAINT ck_se_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- A fantasy XI built from one season's player pool.
CREATE TABLE squads (
  squad_id     MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      MEDIUMINT UNSIGNED NOT NULL,
  season_id    TINYINT UNSIGNED NOT NULL,
  name         VARCHAR(60) NOT NULL,
  formation    VARCHAR(10) NOT NULL DEFAULT '4-4-2',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (squad_id),
  UNIQUE KEY uq_squad_per_user (user_id, name),
  KEY ix_squad_season (season_id),
  CONSTRAINT fk_squad_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_squad_season FOREIGN KEY (season_id)
    REFERENCES seasons (season_id) ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE squad_players (
  squad_id         MEDIUMINT UNSIGNED NOT NULL,
  player_season_id INT UNSIGNED NOT NULL,
  slot             ENUM('GK','DEF','MID','FWD','BENCH') NOT NULL,
  is_captain       TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (squad_id, player_season_id),
  KEY ix_sp_ps (player_season_id),
  CONSTRAINT fk_sp_squad FOREIGN KEY (squad_id)
    REFERENCES squads (squad_id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_ps FOREIGN KEY (player_season_id)
    REFERENCES player_seasons (player_season_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Saved filter definitions, so a scout can re-run a search later.
-- The criteria are stored as JSON and translated back into a
-- parameterised WHERE clause by the API.
CREATE TABLE saved_searches (
  search_id    MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      MEDIUMINT UNSIGNED NOT NULL,
  name         VARCHAR(60) NOT NULL,
  criteria     JSON NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (search_id),
  UNIQUE KEY uq_search_per_user (user_id, name),
  CONSTRAINT fk_search_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
