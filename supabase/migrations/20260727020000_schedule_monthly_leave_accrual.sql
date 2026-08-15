-- Schedule monthly leave accrual via pg_cron.
-- Runs on the 1st of every month at 00:05 (UTC) for all branches.
-- pg_cron must be enabled on the project (Dashboard → Extensions → pg_cron).

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any stale job with the same name before (re-)creating.
SELECT cron.unschedule('monthly-leave-accrual')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'monthly-leave-accrual'
);

SELECT cron.schedule(
  'monthly-leave-accrual',
  '5 0 1 * *',            -- 00:05 UTC on the 1st of every month
  $$ SELECT public.accrue_monthly_leave(); $$
);
