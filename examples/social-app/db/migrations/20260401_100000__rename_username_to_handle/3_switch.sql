-- Phase: switch
-- Group: 20260401_100000__rename_username_to_handle
--
-- Add NOT NULL constraint (NOT VALID for instant lock) and validate separately.
-- After this, all code should read from "handle" instead of "username".

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_handle_not_null'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_handle_not_null
      CHECK (handle IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

RESET lock_timeout;
RESET statement_timeout;
