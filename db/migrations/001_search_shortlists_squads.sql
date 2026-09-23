-- =====================================================================
-- Migration 001 — richer search, shortlists and squad comparison
--
-- Brings an already-loaded database up to date without dropping it, so
-- no player data and no saved shortlists or squads are lost:
--
--   npm run db:migrate
--
-- A fresh install does not need this - db/schema/*.sql already carries
-- these definitions, and db/logic/*.sql carries the new views and
-- procedures that db:migrate applies afterwards.
--
-- Every step is guarded by its own existence check rather than one check
-- for the whole batch, so a half-applied database (or a re-run) still
-- converges instead of failing on the part that is already there.
-- =====================================================================

USE scoutlens;

-- ---------------------------------------------------------------------
-- 1. shortlist_entries.status - where a player sits in the pipeline.
-- ---------------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = 'scoutlens'
                   AND TABLE_NAME = 'shortlist_entries'
                   AND COLUMN_NAME = 'status');
SET @sql := IF(@exists = 0,
  'ALTER TABLE shortlist_entries
     ADD COLUMN status ENUM(''watching'',''shortlisted'',''priority'',''rejected'')
       NOT NULL DEFAULT ''watching'' AFTER note',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. shortlist_entries.updated_at - when the assessment last changed.
-- ---------------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = 'scoutlens'
                   AND TABLE_NAME = 'shortlist_entries'
                   AND COLUMN_NAME = 'updated_at');
SET @sql := IF(@exists = 0,
  'ALTER TABLE shortlist_entries
     ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ON UPDATE CURRENT_TIMESTAMP AFTER added_at',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 3. The index supporting "show me only the priority targets".
-- ---------------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = 'scoutlens'
                   AND TABLE_NAME = 'shortlist_entries'
                   AND INDEX_NAME = 'ix_se_status');
SET @sql := IF(@exists = 0,
  'ALTER TABLE shortlist_entries ADD KEY ix_se_status (shortlist_id, status)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SELECT 'Migration 001 applied. Views and procedures follow.' AS status;
