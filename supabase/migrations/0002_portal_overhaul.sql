-- MCR Partners — Portal Overhaul Migration
-- Migration: 0002_portal_overhaul
-- Changes: New document categories, accountant details, ATO admin, pgvector + RAG

-- ============================================================
-- EXTENSION: pgvector for vector similarity search
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- ALTER: clients — add ATO admin confirmation
-- ============================================================
ALTER TABLE clients ADD COLUMN ato_admin_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN ato_admin_confirmed_at timestamptz;

-- ============================================================
-- ALTER: documents — new category system, text extraction, relax AI columns
-- ============================================================

-- Add user-selected document category
ALTER TABLE documents ADD COLUMN doc_category text;

-- Add extracted text column for RAG pipeline
ALTER TABLE documents ADD COLUMN extracted_text text;

-- Drop old constraints
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_ai_doc_type_check;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;

-- Make AI columns nullable with defaults
ALTER TABLE documents ALTER COLUMN ai_doc_type DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN ai_doc_type SET DEFAULT NULL;
ALTER TABLE documents ALTER COLUMN ai_financial_years DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN ai_financial_years SET DEFAULT '{}';
ALTER TABLE documents ALTER COLUMN ai_confidence DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN ai_confidence SET DEFAULT NULL;

-- Migrate existing rows (if any) before adding NOT NULL constraint
UPDATE documents SET doc_category =
  CASE ai_doc_type
    WHEN 'financial_statements' THEN 'current_financials'
    WHEN 'integrated_client_account' THEN 'integrated_client_account'
    ELSE 'current_financials'
  END
WHERE doc_category IS NULL;

UPDATE documents SET status = 'uploaded'
WHERE status IN ('processing', 'classified', 'needs_review');

-- Now add NOT NULL + CHECK constraints
ALTER TABLE documents ALTER COLUMN doc_category SET NOT NULL;

ALTER TABLE documents ADD CONSTRAINT documents_doc_category_check
  CHECK (doc_category IN (
    'current_financials',
    'historical_financials',
    'integrated_client_account',
    'director_penalty_notices',
    'trust_deed',
    'company_licences'
  ));

ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'processing_text', 'ready', 'rejected'));

-- New index for doc_category
CREATE INDEX IF NOT EXISTS idx_documents_doc_category ON documents(doc_category);

-- ============================================================
-- TABLE: accountant_details
-- ============================================================
CREATE TABLE IF NOT EXISTS accountant_details (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  company_name    text        NOT NULL,
  contact_person  text        NOT NULL,
  phone_number    text        NOT NULL,
  email_address   text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accountant_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountant_details_service_role" ON accountant_details
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "accountant_details_no_anon_read" ON accountant_details
  FOR SELECT USING (false);

CREATE TRIGGER set_accountant_details_updated_at
  BEFORE UPDATE ON accountant_details
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_accountant_details_client_id ON accountant_details(client_id);

-- ============================================================
-- TABLE: document_chunks — pgvector embeddings for RAG
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  chunk_index   integer     NOT NULL,
  chunk_text    text        NOT NULL,
  embedding     vector(1536), -- OpenAI text-embedding-3-small output
  metadata      jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_chunks_service_role" ON document_chunks
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "document_chunks_no_anon_read" ON document_chunks
  FOR SELECT USING (false);

CREATE INDEX IF NOT EXISTS idx_document_chunks_client_id ON document_chunks(client_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- IVFFlat index for vector similarity search
-- Note: requires at least some data to build effectively;
-- for small datasets, exact search (without this index) is fine
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- FUNCTION: match_document_chunks — vector similarity search
-- ============================================================
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_client_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  chunk_text text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.chunk_text,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.client_id = match_client_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
