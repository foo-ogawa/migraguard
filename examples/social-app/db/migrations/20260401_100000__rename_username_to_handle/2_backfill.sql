-- Phase: backfill
-- Group: 20260401_100000__rename_username_to_handle
--
-- Copy existing username values into the new handle column.
-- Executed by external executor in batches.

SET statement_timeout = '300s';

UPDATE users
SET handle = username
WHERE handle IS NULL
  AND id BETWEEN :batch_start AND :batch_end;

RESET statement_timeout;
