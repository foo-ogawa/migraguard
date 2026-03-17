-- Phase: expand
-- Group: 20260401_100000__rename_username_to_handle
--
-- Add "handle" column mirroring "username", install sync trigger.
-- This allows new code to write to "handle" while old code still reads "username".

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(50);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_handle
  ON users (handle) WHERE handle IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_username_to_handle() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.handle IS NULL THEN
    NEW.handle := NEW.username;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_username_to_handle ON users;
CREATE TRIGGER trg_sync_username_to_handle
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_username_to_handle();

RESET lock_timeout;
RESET statement_timeout;
