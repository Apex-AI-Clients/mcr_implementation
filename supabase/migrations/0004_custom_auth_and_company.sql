-- Migration: add company_details table for Company/Trust Details step

CREATE TABLE IF NOT EXISTS public.company_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  company_name text,
  acn_number text,
  abn_number text,
  trust_name text,
  phone_number text,
  email_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_details ENABLE ROW LEVEL SECURITY;

-- RLS: service role can do everything (API routes use service role client)
CREATE POLICY "Service role full access" ON public.company_details
  FOR ALL USING (true) WITH CHECK (true);

-- Add reupload_requested flag to documents for admin reupload feature
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS reupload_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reupload_reason text;
