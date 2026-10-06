-- Migration: at most one active financials comparison job per client.
--
-- The start route checked for an active job and then inserted one — two
-- requests close together (a start retried after its answer was lost, a
-- double trigger) could both pass the check and both insert, so two jobs ran
-- the same extraction side by side. A partial unique index makes the second
-- insert fail; the start route then returns the job already running.
--
-- Safe to re-run. One transaction. Old code keeps working: its duplicate
-- insert now fails ("Failed to create job.") instead of starting a second run.

BEGIN;

-- Any client with more than one active job today keeps its newest; the
-- others are marked failed so the index can be built.
UPDATE public.financial_comparison_jobs j
   SET status = 'failed',
       error = 'Superseded: only one comparison job may run per client.',
       updated_at = now(),
       finished_at = now()
 WHERE j.status IN ('pending', 'processing')
   AND EXISTS (
     SELECT 1
       FROM public.financial_comparison_jobs k
      WHERE k.client_id = j.client_id
        AND k.status IN ('pending', 'processing')
        AND (k.created_at, k.id) > (j.created_at, j.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS financial_comparison_jobs_one_active_per_client
  ON public.financial_comparison_jobs (client_id)
  WHERE status IN ('pending', 'processing');

-- The non-unique index 0013 added for the same lookup is now redundant.
DROP INDEX IF EXISTS public.financial_comparison_jobs_active_idx;

COMMIT;
