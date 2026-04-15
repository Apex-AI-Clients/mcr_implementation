-- MCR Partners × Apex AI — Initial Schema
-- Migration: 0001_initial_schema

-- ============================================================
-- HELPER: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: clients
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  email             text        NOT NULL UNIQUE,
  status            text        NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'in_progress', 'complete', 'missing_items')),
  magic_link_token  text        UNIQUE,
  link_expires_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Service role has full access (server-side only)
CREATE POLICY "clients_service_role" ON clients
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Anonymous cannot read clients
CREATE POLICY "clients_no_anon_read" ON clients
  FOR SELECT USING (false);

-- ============================================================
-- TABLE: documents
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_path           text        NOT NULL,
  original_filename   text        NOT NULL,
  file_type           text        NOT NULL,
  file_size_bytes     bigint      NOT NULL DEFAULT 0,
  ai_doc_type         text        NOT NULL DEFAULT 'unknown'
                      CHECK (ai_doc_type IN (
                        'financial_statements',
                        'integrated_client_account',
                        'income_tax_account',
                        'bas_statements',
                        'creditor_list',
                        'ato_debt_letters',
                        'director_loan_account',
                        'superannuation_records',
                        'unknown'
                      )),
  ai_financial_years  text[]      NOT NULL DEFAULT '{}',
  ai_confidence       float       NOT NULL DEFAULT 0,
  ai_raw_response     jsonb,
  status              text        NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing', 'classified', 'needs_review', 'rejected')),
  uploaded_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_service_role" ON documents
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "documents_no_anon_read" ON documents
  FOR SELECT USING (false);

-- ============================================================
-- TABLE: follow_ups
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_ups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type          text        NOT NULL
                CHECK (type IN ('auto', 'manual')),
  missing_items text[]      NOT NULL DEFAULT '{}',
  sent_at       timestamptz NOT NULL DEFAULT now(),
  email_status  text        NOT NULL DEFAULT 'pending'
);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_ups_service_role" ON follow_ups
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "follow_ups_no_anon_read" ON follow_ups
  FOR SELECT USING (false);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_magic_link_token ON clients(magic_link_token);
CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_ai_doc_type ON documents(ai_doc_type);
CREATE INDEX IF NOT EXISTS idx_follow_ups_client_id ON follow_ups(client_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_sent_at ON follow_ups(sent_at);
