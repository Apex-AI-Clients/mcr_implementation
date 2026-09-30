-- Migration: close the "Service role full access" policies to everyone else.
--
-- Migrations 0004, 0005, 0009, 0010 and 0013 each created a policy named
-- "Service role full access" as FOR ALL USING (true) WITH CHECK (true) with no
-- TO clause. A policy without TO applies to PUBLIC, so these granted the anon
-- and authenticated roles full read and write on the seven tables below. The
-- publishable key ships in the browser bundle, so in practice anybody could
-- read, change or delete these rows through PostgREST.
--
-- They never did anything for the role they were named after: service_role
-- bypasses RLS entirely. Every read and write of these tables goes through an
-- API route on the service-role client (getSupabaseServerClient); the browser
-- client is used for auth only, and the session (SSR) client only reads the
-- user. So dropping them changes nothing for the app.
--
-- With RLS still enabled and no policy left, anon and authenticated see zero
-- rows and cannot write. That is the intended state, and it has to be in place
-- before 0022 starts storing directors' dates of birth in company_details.
-- supabase/tests/anon_rls.test.ts checks it.

DROP POLICY IF EXISTS "Service role full access" ON public.company_details;
DROP POLICY IF EXISTS "Service role full access" ON public.lodgement_analyses;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_statements;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_comparisons;
DROP POLICY IF EXISTS "Service role full access" ON public.sbr_historical_cases;
DROP POLICY IF EXISTS "Service role full access" ON public.sbr_outcome_predictions;
DROP POLICY IF EXISTS "Service role full access" ON public.financial_comparison_jobs;

-- Belt and braces: RLS was enabled on all seven when they were created, but a
-- table with RLS off would be wide open once its policy is gone.
ALTER TABLE public.company_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lodgement_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sbr_historical_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sbr_outcome_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_comparison_jobs ENABLE ROW LEVEL SECURITY;
