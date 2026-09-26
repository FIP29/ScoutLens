-- =====================================================================
-- ScoutLens - admin account
--
-- A single fixed administrator who can add, edit and delete players.
-- Everything else in the app is public and needs no login.
--
-- The CHECK constraint pins id to 1, so the database itself guarantees
-- there is never more than one admin row. Create or reset it with:
--
--   npm run admin:set
--
-- This table is deliberately absent from db/seed/: credentials never go
-- into files that are committed to the repository.
-- =====================================================================

USE scoutlens;

CREATE TABLE admins (
  id            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  email         VARCHAR(254)     NOT NULL,
  password_hash CHAR(60)         NOT NULL,   -- bcrypt output is always 60 chars
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email),
  CONSTRAINT ck_admins_single CHECK (id = 1)
) ENGINE=InnoDB;
