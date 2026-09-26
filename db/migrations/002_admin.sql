-- =====================================================================
-- Migration 002 - admin account and the peer-comparison index
--
-- Brings an already-loaded database up to date without dropping it:
--
--   npm run db:migrate
--
-- A fresh install does not need this: db/schema/04_admin.sql creates the
-- admins table and db/schema/01_schema.sql carries the index.
--
-- Deleting a player needs no change here. Every foreign key on the path
-- players -> player_seasons -> stats / fantasy points / shortlists /
-- squads is already ON DELETE CASCADE (see db/schema/*.sql), so a single
-- DELETE FROM players removes the player and everything hanging off them.
-- =====================================================================

USE scoutlens;

-- ---------------------------------------------------------------------
-- 1. The admin account.
--
-- There is exactly one admin, and the database enforces it rather than
-- trusting the application to: id is fixed at 1 by a CHECK constraint, so
-- a second row cannot be inserted by any client. `npm run admin:set`
-- upserts that row, which is also how the password is changed.
--
-- password_hash is CHAR(60) because bcrypt output is always 60 characters.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  email         VARCHAR(254)     NOT NULL,
  password_hash CHAR(60)         NOT NULL,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email),
  CONSTRAINT ck_admins_single CHECK (id = 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. Peer-group index.
--
-- The above-average query compares each player with the others in the
-- same season, league and position. That triple is exactly the correlated
-- subquery's WHERE clause, so an index on it lets each lookup be an index
-- range scan instead of a filter over the season/league slice.
-- ---------------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = 'scoutlens'
                   AND TABLE_NAME = 'player_seasons'
                   AND INDEX_NAME = 'ix_ps_peer_group');
SET @sql := IF(@exists = 0,
  'ALTER TABLE player_seasons
     ADD KEY ix_ps_peer_group (season_id, league_id, primary_position)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SELECT 'Migration 002 applied.' AS status;
