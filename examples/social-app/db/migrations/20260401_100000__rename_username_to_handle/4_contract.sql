-- Phase: contract
-- Group: 20260401_100000__rename_username_to_handle
--
-- Remove the sync trigger and drop the old "username" column.
-- Only execute after all application code has migrated to "handle".

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP TRIGGER IF EXISTS trg_sync_username_to_handle ON users;
DROP FUNCTION IF EXISTS sync_username_to_handle();

-- migraguard:allow ban-drop-column
ALTER TABLE users DROP COLUMN IF EXISTS username;

DROP INDEX CONCURRENTLY IF EXISTS idx_users_username;

RESET lock_timeout;
RESET statement_timeout;
