-- Migration: the client's own phone number.
--
-- Step 1 of the SBR intake, and the lead-conversion dialog that feeds it, now
-- ask for the client's phone alongside their name and email. It is the
-- contact person's number — usually the director's mobile, carried over from
-- the lead — and deliberately separate from company_details.phone_number,
-- which is the company or trust's own line.
--
-- Nullable: clients created before this column, and intake clients whose
-- number is not known yet, have none. Stored normalised (0412345678) by the
-- API, the same shape as leads.phone.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone text;
