-- Migration: the fields Gabby re-types from the ASIC Current Company Extract.
--
-- Filled at lead conversion (and on the intake company step) from an uploaded
-- extract PDF, parsed on our own server, or typed by hand. Every one is
-- optional: conversion never depends on an upload.
--
-- Depends on 0021. directors carries dates of birth, and this table must not be
-- readable with the publishable key before it holds them.
--
-- directors is a jsonb array of { "name": text, "dateOfBirth": text } rather
-- than its own table. The directors are always read and written with the rest
-- of this row, and one column keeps the "absent is not empty" rule of
-- src/lib/clients/companyDetails.ts to a single check. dateOfBirth is an ISO
-- string of reduced precision — "1970-03-14", "1970-03" or "1970" — because
-- ASIC is consulting on showing only the year of birth, which a date column
-- could not hold. The shape of each element is validated in the API routes;
-- the database only guarantees it is an array.
--
-- Deliberately not stored: place of birth, residential addresses, appointment
-- dates, shareholders, and the PDF itself.

ALTER TABLE public.company_details
  ADD COLUMN IF NOT EXISTS registered_office_address text,
  ADD COLUMN IF NOT EXISTS principal_place_of_business text,
  ADD COLUMN IF NOT EXISTS directors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The extract's own "Date/Time" from its cover page — the "as at" date.
  ADD COLUMN IF NOT EXISTS asic_extract_date timestamptz,
  -- 'asic_pdf'        filled from an extract and saved unchanged
  -- 'asic_pdf_edited' filled from an extract, then an address or a director
  --                   was changed before saving
  -- 'manual'          entered by hand, no extract
  -- null              saved before this existed. Decided by the browser, which
  --                   knows what the fill contained; the routes check the enum.
  ADD COLUMN IF NOT EXISTS company_details_source text;

ALTER TABLE public.company_details
  DROP CONSTRAINT IF EXISTS company_details_directors_is_array,
  ADD CONSTRAINT company_details_directors_is_array
    CHECK (jsonb_typeof(directors) = 'array');

ALTER TABLE public.company_details
  DROP CONSTRAINT IF EXISTS company_details_source_check,
  ADD CONSTRAINT company_details_source_check
    CHECK (company_details_source IN ('asic_pdf', 'asic_pdf_edited', 'manual'));
