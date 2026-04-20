-- MCR Partners — Switch from magic-link tokens to Supabase Auth (email + password) for clients.
-- Migration: 0003_supabase_auth_clients
--
-- Changes:
--   • Drop follow_ups table (automated reminder system removed).
--   • Drop clients.magic_link_token + clients.link_expires_at (replaced by Supabase Auth session).
--   • Add clients.auth_user_id uuid UNIQUE FK -> auth.users(id) ON DELETE SET NULL.
--
-- Existing client rows (if any) will have auth_user_id = NULL and will need to be re-invited
-- through the new Supabase Auth flow.

-- ============================================================
-- follow_ups table + related index/policy — gone
-- ============================================================
DROP TABLE IF EXISTS follow_ups CASCADE;

-- ============================================================
-- clients — drop magic-link columns, add auth.users link
-- ============================================================
DROP INDEX IF EXISTS idx_clients_magic_link_token;

ALTER TABLE clients DROP COLUMN IF EXISTS magic_link_token;
ALTER TABLE clients DROP COLUMN IF EXISTS link_expires_at;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_auth_user_id ON clients(auth_user_id);
