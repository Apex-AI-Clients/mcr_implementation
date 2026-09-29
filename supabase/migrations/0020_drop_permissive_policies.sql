-- Migration: drop the "Service role full access" policies.
--
-- Security fix, deliberately on its own and ahead of any feature work.
--
-- Migrations 0004, 0005, 0009, 0010 and 0013 each created a policy named
-- "Service role full access" as FOR ALL USING (true) WITH CHECK (true) with no
-- TO clause. A policy without TO applies to PUBLIC, which in Supabase means the
-- anon and authenticated roles as well — so on a project with the default
-- table grants, anyone holding the publishable key (it ships in the browser
-- bundle) could read, insert, update and delete these tables through PostgREST.
--
-- The policies never did anything for the service role: it bypasses RLS. Every
-- read and write of these tables goes through getSupabaseServerClient() (service
-- role), so with the policies gone RLS denies everyone else and nothing in the
-- app changes.
--
-- The REVOKE is belt and braces: with RLS on and no policy, anon and
-- authenticated already see nothing, but they no longer hold the privileges
-- either, so a policy added carelessly later cannot reopen these tables alone.
--
-- company_details is about to hold directors' dates of birth (0021), which is
-- why this goes first.

DROP POLICY IF EXISTS "Service role full access" ON public.company_details;
DROP POLICY IF EXISTS "Service role full access" ON public.lodgement_analyses;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_statements;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_comparisons;
DROP POLICY IF EXISTS "Service role full access" ON public.sbr_historical_cases;
DROP POLICY IF EXISTS "Service role full access" ON public.sbr_outcome_predictions;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_comparison_jobs;

REVOKE ALL ON TABLE
  public.company_details,
  public.lodgement_analyses,
  public.financial_statements,
  public.financial_comparisons,
  public.sbr_historical_cases,
  public.sbr_outcome_predictions,
  public.financial_comparison_jobs
FROM anon, authenticated;
