-- Migration: historical SBR cases + cached per-client predictions.
--
-- Seeded from Tom's GABI AI DATA workbook (May 2026 export). Future Bicycle
-- Innovations Pty Ltd and Life On Demand Pty Ltd (the two 9.3% outliers) are
-- excluded — confirmed data errors per Gabby. 49 cases at seed time; admins
-- add new cases as deals conclude.

CREATE TABLE IF NOT EXISTS public.sbr_historical_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  -- Predictive features (the 8 inputs)
  dpn boolean NOT NULL,
  payment_plan_type text NOT NULL CHECK (payment_plan_type IN ('plan', 'upfront')),
  director_loan_at_appointment boolean NOT NULL,
  director_loan_sent_to_ato boolean NOT NULL,
  director_loan_receivable_amount numeric NOT NULL DEFAULT 0,
  cumulative_days_late integer NOT NULL,
  number_of_late_lodgements integer NOT NULL,
  days_since_last_payment integer NOT NULL,  -- 9999 sentinel for "NO PAYMENTS EVER"
  -- Outcome (the target)
  outcome_percent numeric NOT NULL,           -- e.g. 40.3
  accepted boolean NOT NULL,
  -- Reference (not used in prediction but kept for the UI)
  creditor_amount numeric NOT NULL,
  sbr_payment numeric NOT NULL,
  -- Audit
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sbr_historical_cases_added_at_idx
  ON public.sbr_historical_cases (added_at DESC);

-- Cached predictions per client so re-visiting the page doesn't recompute.
CREATE TABLE IF NOT EXISTS public.sbr_outcome_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  input_features jsonb NOT NULL,    -- the 8 inputs used
  predicted_outcome_percent numeric NOT NULL,
  predicted_low_percent numeric NOT NULL,
  predicted_high_percent numeric NOT NULL,
  comparable_case_ids uuid[] NOT NULL,
  training_set_size integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

ALTER TABLE public.sbr_historical_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sbr_outcome_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.sbr_historical_cases
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.sbr_outcome_predictions
  FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed data: 49 historical cases derived from gabi file/sbr_historical_cases.csv.
-- Future Bicycle Innovations and Life On Demand are intentionally absent.
-- Re-running this migration is idempotent: ON CONFLICT DO NOTHING guards against
-- duplicating the seed on a re-apply, keyed by client_name.

ALTER TABLE public.sbr_historical_cases
  ADD CONSTRAINT sbr_historical_cases_client_name_key UNIQUE (client_name);

INSERT INTO public.sbr_historical_cases (
  client_name, dpn, payment_plan_type, director_loan_at_appointment,
  director_loan_sent_to_ato, director_loan_receivable_amount,
  cumulative_days_late, number_of_late_lodgements, days_since_last_payment,
  outcome_percent, accepted, creditor_amount, sbr_payment
) VALUES
  ('George Joseph Pty Ltd', false, 'upfront', false, true, 503544, 3944, 25, 14, 40.3, true, 317450.60, 142000),
  ('Feels Like Home Support Services Pty Ltd', false, 'plan', false, false, 0, 204, 8, 87, 40.2, true, 137242.00, 63000),
  ('KSVN Partners Pty Ltd', true, 'plan', false, false, 0, 6498, 38, 31, 51.6, true, 229009.00, 135000),
  ('Globexo Pty Ltd', true, 'upfront', false, false, 0, 45866, 114, 9999, 61.7, false, 928421.62, 600000),
  ('Fly Express Pty Ltd', false, 'upfront', false, false, 0, 1313, 15, 1999, 46.7, false, 107231.00, 55000),
  ('Specialized Services Australia Pty Ltd', false, 'upfront', true, false, 0, 6547, 39, 1, 51.2, true, 184507.00, 105000),
  ('Ozzymas Pty Ltd', false, 'plan', false, false, 0, 820, 13, 391, 36.2, true, 220755.08, 90000),
  ('Flor & Vine Pty Ltd', false, 'plan', false, false, 0, 305, 6, 12, 32.7, true, 483991.47, 180000),
  ('Barrica Wines Pty Ltd', false, 'plan', true, false, 0, 911, 8, 12, 35.3, true, 347424.00, 140000),
  ('Mumma G''s Pizza & Pasta Pty Ltd', false, 'plan', false, false, 0, 7, 1, 6, 36.3, true, 446214.00, 185000),
  ('Plumb Cut Carpentry Pty Limited', true, 'upfront', false, false, 0, 3006, 21, 720, 50.5, true, 271084.02, 150000),
  ('Hugo''s Brew & Chew Pty Ltd', false, 'upfront', false, false, 0, 81, 10, 192, 29.6, true, 268214.01, 77500),
  ('Silk Cleaning and Services Pty Ltd', true, 'upfront', false, false, 0, 568, 9, 6, 39.9, true, 191736.00, 85000),
  ('Custom Edge Trading Pty Ltd', false, 'plan', true, false, 0, 153, 1, 344, 39.7, true, 242574.00, 110000),
  ('Scholar&Stacey Pty Ltd', false, 'upfront', false, false, 0, 2353, 17, 167, 40.1, true, 269403.00, 12000),
  ('Daniel Siric Architects Pty Ltd', false, 'upfront', true, false, 0, 73, 9, 245, 37.4, true, 140495.92, 60000),
  ('Badlands Brewery Pty Ltd', false, 'upfront', false, false, 0, 10344, 15, 0, 61.0, true, 364068.00, 240000),
  ('Monson Transport (TAS) Pty Ltd', false, 'upfront', true, false, 0, 2501, 12, 66, 58.6, false, 607773.00, 375000),
  ('Shearwater Iga Pty Ltd', false, 'plan', false, false, 0, 52, 4, 211, 34.4, true, 419220.11, 165000),
  ('Salami Bros Pty Ltd', false, 'plan', false, false, 0, 1546, 12, 62, 45.9, true, 241617.71, 120000),
  ('Deep Fried Hospitality Pty Ltd', false, 'plan', false, false, 0, 2771, 19, 126, 29.5, true, 474937.00, 160000),
  ('Artea Green Ventures Pty Ltd', false, 'upfront', false, false, 0, 1187, 13, 335, 40.0, false, 163999.61, 75000),
  ('Clearvision Security and Automation Pty Ltd', false, 'upfront', true, false, 0, 314, 7, 177, 37.2, true, 199997.00, 85000),
  ('Guardian Care Community Innovation Pty Ltd', false, 'plan', false, false, 0, 606, 13, 6, 40.1, true, 458125.30, 210000),
  ('Glenmarks Property Services Pty Ltd', false, 'plan', false, false, 0, 748, 20, 10, 40.0, true, 262265.00, 120000),
  ('Cheap Mobile Repair Pty Ltd', true, 'upfront', false, false, 0, 110, 2, 105, 50.2, true, 317297.00, 175000),
  ('Lucca Charlie Bros and Co Pty Ltd', false, 'upfront', true, false, 0, 677, 7, 90, 49.8, false, 316015.00, 170000),
  ('RBT Fire Consulting Pty Ltd', true, 'plan', true, true, 5097, 71, 3, 13, 34.3, true, 305788.00, 120000),
  ('East Family Constructions Pty Ltd', false, 'plan', false, false, 0, 723, 18, 392, 40.6, true, 486231.41, 220000),
  ('Pipedream4 Enterprises Pty Ltd', false, 'plan', false, false, 0, 3906, 23, 419, 53.6, true, 307193.00, 183000),
  ('Atlantic Cement Rendering Pty Ltd', false, 'upfront', false, false, 0, 591, 7, 812, 44.2, false, 153563.00, 77500),
  ('Harbourside Venues Pty Ltd', false, 'upfront', false, false, 0, 2701, 15, 319, 36.2, true, 472143.00, 185000),
  ('Ryenmal Pty Ltd', false, 'plan', false, false, 0, 145, 6, 40, 33.7, true, 291837.56, 112500),
  ('Copy Smart Pty Ltd', false, 'plan', true, false, 0, 67, 8, 283, 36.9, true, 248744.64, 105000),
  ('The Bootlegger Bar (Katoomba) Pty Ltd', false, 'plan', false, false, 0, 593, 11, 51, 36.2, true, 362612.81, 150000),
  ('Australian Workplace Training Pty Ltd', false, 'plan', false, false, 0, 1722, 13, 115, 47.8, true, 648416.00, 335000),
  ('Spitimas Pty Ltd', false, 'plan', false, false, 0, 4921, 24, 53, 48.3, true, 316209.00, 165000),
  ('ELC Penrith Pty Ltd', true, 'plan', false, false, 0, 2982, 32, 1, 40.3, true, 122930.00, 55000),
  ('SML Parking Prevention Pty Ltd', false, 'upfront', false, false, 0, 208, 11, 123, 34.7, true, 479502.00, 185000),
  ('Snowy Mountains Shearing Pty Ltd', true, 'upfront', true, false, 0, 2012, 19, 35, 40.6, true, 265900.00, 120000),
  ('Wallsend Pizza Pty Ltd', false, 'plan', false, false, 0, 540, 7, 727, 46.7, true, 284194.95, 147500),
  ('Newcastle City Pizza Pty Ltd', true, 'upfront', false, false, 0, 372, 6, 81, 46.4, true, 897272.00, 450000),
  ('Blonde Republic Pty Ltd', false, 'plan', true, false, 0, 20, 3, 1, 36.3, true, 301383.00, 125000),
  ('Rethus Fire Protection Pty Ltd', true, 'upfront', false, false, 0, 589, 9, 601, 40.6, false, 586792.00, 265000),
  ('HTB Felicitas Pty Ltd', false, 'plan', false, false, 0, 2752, 17, 31, 40.1, true, 381444.00, 175000),
  ('TTB Enterprises Pty Ltd', false, 'plan', false, false, 0, 1175, 22, 1, 41.2, true, 212586.00, 100000),
  ('Sunset Welding NQ Pty Ltd', true, 'upfront', false, false, 0, 1372, 26, 812, 39.0, true, 711975.00, 395000),
  ('Wheel''n & Deal''n Pty Ltd', false, 'upfront', false, false, 0, 4737, 17, 13, 30.3, false, 327863.21, 107500),
  ('New Golden West Joinery Pty Ltd', false, 'upfront', false, false, 0, 140, 7, 277, 39.7, true, 305885.42, 135000)
ON CONFLICT (client_name) DO NOTHING;
