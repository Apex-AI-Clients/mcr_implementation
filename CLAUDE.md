# MCR Partners × Apex AI — Document Upload Portal

> Claude Code instruction file. Read this before writing any code in this project.

---

## Project Overview

A two-sided B2B web application built on Next.js 16 App Router. **MCR staff** manage clients and track document completeness via an admin panel. **Clients** upload financial documents via a passwordless magic-link portal. An **AI layer** (Claude Sonnet) classifies each upload, identifies financial years, and scores completeness. Automated follow-up emails fire at Day 2 and Day 5 for missing documents.

Key constraint: clients never create passwords. Auth is a single-use, 15-day magic link token only. The client portal must feel premium and non-technical — MCR's word is "exclusive".

---

## Project Structure

Do not invent file paths. Every file lives exactly here:

```
mcr_implementation/
├── CLAUDE.md
├── .env                          # Never commit. Keys listed in .env.example
├── .env.example                  # Committed. All keys, no values
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 0001_initial_schema.sql
├── .claude/
│   └── skills/
│       ├── new-migration/SKILL.md
│       ├── seed-client/SKILL.md
│       ├── classify-doc/SKILL.md
│       ├── smoke-test/SKILL.md
│       └── type-audit/SKILL.md
└── src/
    ├── app/
    │   ├── layout.tsx                    # Root layout
    │   ├── globals.css
    │   ├── (admin)/                      # Route group — MCR staff only
    │   │   ├── layout.tsx                # Admin shell: sidebar, auth guard
    │   │   └── admin/
    │   │       ├── page.tsx              # Dashboard overview
    │   │       └── clients/
    │   │           ├── page.tsx          # Client list + invite form
    │   │           └── [id]/
    │   │               └── page.tsx      # Client detail: docs + actions
    │   ├── (portal)/                     # Route group — magic link only
    │   │   ├── layout.tsx                # Portal shell: branding only
    │   │   └── portal/
    │   │       └── [token]/
    │   │           └── page.tsx          # Client upload page
    │   └── api/
    │       ├── admin/
    │       │   └── clients/
    │       │       ├── route.ts          # GET list, POST create + send invite
    │       │       └── [id]/
    │       │           ├── route.ts      # GET detail, PATCH update
    │       │           └── send-reminder/
    │       │               └── route.ts  # POST manual reminder
    │       ├── portal/
    │       │   ├── validate-token/
    │       │   │   └── route.ts          # GET — validate magic link token
    │       │   └── upload/
    │       │       └── route.ts          # POST — receive file, store, classify
    │       ├── classify-document/
    │       │   └── route.ts              # POST — server-only Claude API call
    │       └── cron/
    │           └── send-reminders/
    │               └── route.ts          # GET — Vercel cron, every 6 hours
    ├── components/
    │   ├── ui/                           # Primitive, reusable
    │   │   ├── Button.tsx
    │   │   ├── Badge.tsx
    │   │   ├── Card.tsx
    │   │   ├── Input.tsx
    │   │   ├── Progress.tsx
    │   │   └── Spinner.tsx
    │   ├── admin/
    │   │   ├── ClientTable.tsx           # Sortable client list
    │   │   ├── InviteClientForm.tsx      # Add client + send magic link
    │   │   ├── DocumentStatusGrid.tsx    # 8-doc checklist per client
    │   │   ├── CompletenessBar.tsx       # Visual progress bar
    │   │   └── ReminderButton.tsx        # Trigger manual follow-up
    │   └── portal/
    │       ├── DropZone.tsx              # react-dropzone wrapper
    │       ├── DocumentChecklist.tsx     # What's needed vs uploaded
    │       ├── UploadedFileRow.tsx       # Single file: name, type, status
    │       └── PortalHeader.tsx          # Branded MCR header
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts                 # Browser Supabase client (singleton)
    │   │   └── server.ts                 # Server Supabase client (cookies)
    │   ├── ai/
    │   │   ├── classify.ts               # Orchestrates the classification pipeline
    │   │   └── prompts.ts                # ALL Claude prompt templates (single source of truth)
    │   ├── email/
    │   │   ├── resend.ts                 # Resend client singleton
    │   │   └── templates/
    │   │       ├── MagicLinkEmail.tsx    # React Email: invite template
    │   │       └── ReminderEmail.tsx     # React Email: reminder template
    │   ├── storage/
    │   │   └── upload.ts                 # Supabase Storage helpers
    │   ├── ocr/
    │   │   └── extract.ts                # pdf-parse + Tesseract.js pipeline
    │   ├── tokens.ts                     # Magic link generation + validation
    │   ├── constants.ts                  # DOCUMENT_TYPES, thresholds (see below)
    │   └── utils.ts                      # cn(), formatBytes(), formatDate()
    ├── types/
    │   ├── database.ts                   # Supabase generated types (auto-generated)
    │   └── app.ts                        # Application-level interfaces
    └── middleware.ts                     # Next.js middleware: admin auth guard
```

---

## Environment Variables

All required. Never expose server-only vars to the browser.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=              # https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=  # anon/public key (browser-safe)
SUPABASE_SERVICE_ROLE_KEY=             # service_role key — SERVER ONLY

# AI
ANTHROPIC_API_KEY=                     # sk-ant-... SERVER ONLY, only in /api/classify-document

# Email
RESEND_API_KEY=                        # re_...
RESEND_FROM_EMAIL=                     # verified sending address

# Security
CRON_SECRET=                           # Random 32-char string

# App
NEXT_PUBLIC_APP_URL=                   # https://your-domain.vercel.app (no trailing slash)
```

**Non-negotiable security rules:**
- `SUPABASE_SERVICE_ROLE_KEY` must never appear in `src/components/` or `src/app/(portal)/`
- `ANTHROPIC_API_KEY` must only appear in `src/app/api/classify-document/route.ts`
- All file downloads use `createSignedUrl()` with ≤ 300s expiry — never `getPublicUrl()`
- Magic link tokens are nulled in DB on first use (in validate-token route, not the page)

---

## Development Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run type-check   # tsc --noEmit — MUST pass before marking any task complete
npm run lint         # ESLint — zero warnings in new files
npm run build        # Full production build
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright end-to-end
```

Supabase CLI:
```bash
npx supabase start                                                   # Start local stack
npx supabase db reset                                                # Apply all migrations fresh
npx supabase migration new <name>                                    # New migration file
npx supabase gen types typescript --local > src/types/database.ts   # Regenerate types
```

**Rule:** After every migration, regenerate types and commit both files together.

---

## Document Types — Canonical Reference

Source of truth: `src/lib/constants.ts`. Never use ad-hoc strings.

| Key | DB Value | Label | Format | Years |
|---|---|---|---|---|
| `FINANCIAL_STATEMENTS` | `financial_statements` | Financial Statements (P&L + Balance Sheet) | PDF or CSV | Last 2–3 years |
| `ICA` | `integrated_client_account` | Integrated Client Account (ICA) | CSV preferred | Full history |
| `INCOME_TAX` | `income_tax_account` | Income Tax Account | CSV preferred | Full history |
| `BAS` | `bas_statements` | BAS Statements | PDF | Last 2–3 years |
| `CREDITOR_LIST` | `creditor_list` | Creditor List with Amounts | CSV or PDF | Current |
| `ATO_DEBT` | `ato_debt_letters` | ATO Debt Letters / Statements | PDF | Current |
| `DIRECTOR_LOAN` | `director_loan_account` | Director Loan Account Details | PDF or CSV | Last 2–3 years |
| `SUPERANNUATION` | `superannuation_records` | Superannuation Records | PDF | Current |
| `UNKNOWN` | `unknown` | Unknown Document | — | — |

---

## API Route Map

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/clients` | GET | Admin session | List all clients with doc counts |
| `/api/admin/clients` | POST | Admin session | Create client, generate token, send invite email |
| `/api/admin/clients/[id]` | GET | Admin session | Single client with all docs + follow-up history |
| `/api/admin/clients/[id]` | PATCH | Admin session | Update client status |
| `/api/admin/clients/[id]/send-reminder` | POST | Admin session | Send manual reminder email |
| `/api/portal/validate-token` | GET | None | Validate magic link, return client name, null the token |
| `/api/portal/upload` | POST | Token header | Store file to Supabase Storage, trigger classification |
| `/api/classify-document` | POST | `x-internal-secret` header | Extract text → Claude API → return classification JSON |
| `/api/cron/send-reminders` | GET | `CRON_SECRET` bearer | Check all in-progress clients, send Day 2 / Day 5 emails |

Classification flow: `portal/upload` → `lib/ocr/extract.ts` → POST `/api/classify-document` → update `documents` row.

---

## Key Rules

### Security
1. `SUPABASE_SERVICE_ROLE_KEY` — server-only. Zero tolerance elsewhere.
2. `ANTHROPIC_API_KEY` — only in `/api/classify-document/route.ts`.
3. File downloads: always `createSignedUrl()`, expiry ≤ 300s. Never `getPublicUrl()`.
4. Magic link tokens: single-use. Null in DB on first validation, before page renders.
5. RLS enabled on every table.
6. Cron endpoint: verify `Authorization: Bearer $CRON_SECRET`. Return 401 if wrong.

### Code Patterns
7. Server Supabase client in all API routes and Server Components. Browser client only for real-time in Client Components.
8. All DB calls typed using generated `database.ts` types.
9. API routes return `{ error: string }` with correct HTTP status on failure.
10. File uploads stored at `documents/{client_id}/{uuid}.{ext}` in Supabase Storage.

### AI Integration
11. Claude model: `claude-sonnet-4-20250514`. Hardcode only in `lib/ai/prompts.ts` as `CLAUDE_MODEL` constant.
12. Classification prompt must include all 8 canonical document type values from `constants.ts`.
13. Confidence < 0.6 → `ai_doc_type = 'unknown'`, `status = 'needs_review'`.
14. Store raw Claude response in `ai_raw_response jsonb` column for cost auditing.

### AI Confidence Thresholds
| Confidence | Action | UI Badge |
|---|---|---|
| ≥ 0.85 | Auto-classify | Green |
| 0.60–0.84 | Classify + flag | Amber |
| < 0.60 | Set unknown, needs_review | Red |

### Naming
15. API route directories: kebab-case. Filename: `route.ts`.
16. Components: PascalCase filename, named export.
17. Hooks: `use` prefix, camelCase.
18. DB columns: snake_case.

### Before Marking Any Task Complete
19. `npm run type-check` → zero errors.
20. `npm run lint` → zero errors in modified files.
21. If DB schema changed: regenerate `src/types/database.ts` and commit with migration.
22. If new env var added: add to `.env.example`.

---

## Database Schema

```sql
-- clients
id uuid PK, name text, email text UNIQUE,
status text CHECK (status IN ('invited','in_progress','complete','missing_items')),
magic_link_token text UNIQUE, link_expires_at timestamptz,
created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()

-- documents
id uuid PK, client_id uuid FK→clients,
file_path text, original_filename text, file_type text, file_size_bytes bigint,
ai_doc_type text CHECK (ai_doc_type IN ('financial_statements','integrated_client_account',
  'income_tax_account','bas_statements','creditor_list','ato_debt_letters',
  'director_loan_account','superannuation_records','unknown')),
ai_financial_years text[], ai_confidence float, ai_raw_response jsonb,
status text CHECK (status IN ('processing','classified','needs_review','rejected')),
uploaded_at timestamptz DEFAULT now()

-- follow_ups
id uuid PK, client_id uuid FK→clients,
type text CHECK (type IN ('auto','manual')),
missing_items text[], sent_at timestamptz, email_status text
```

---

## Branding Tokens

Use only via Tailwind config — never hardcode hex in components.

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#1A1A2E` | Backgrounds, nav |
| `accent` | `#E94560` | CTAs, highlights |
| `surface` | `#16213E` | Cards, panels |
| `foreground` | `#EAEAEA` | Body text |
| `success` | `#00B894` | Received docs |
| `warning` | `#FDCB6E` | Format warnings |
| `destructive` | `#D63031` | Missing docs, errors |

---

*MCR Partners × Apex AI — Phase 1. Prepared 10 April 2026.*
