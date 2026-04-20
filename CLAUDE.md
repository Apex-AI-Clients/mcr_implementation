# MCR Partners × Apex AI — Document Upload Portal

> Claude Code instruction file. Read this before writing any code in this project.

---

## Project Overview

A two-sided B2B web application built on Next.js 16 App Router. **MCR staff** manage clients and track document completeness via an admin panel. **Clients** upload financial documents via a password-protected portal. An **AI layer** (Claude Sonnet) classifies each upload, identifies financial years, and scores completeness.

Authentication is Supabase Auth (email + password) for **both** sides:

- **Admins** — pre-created in Supabase, sign in at `/admin/login`.
- **Clients** — invited by an admin via `supabase.auth.admin.inviteUserByEmail()`. Supabase sends the invite email from its built-in SMTP. The client clicks it, lands on `/portal/set-password`, sets a password, and is dropped into the portal. On future visits they sign in at `/portal/login` with their email + password.

Role separation is enforced via `auth.users.app_metadata.role` — clients are tagged `role: 'client'`, admins have no `role` or `role !== 'client'`. The proxy (`src/proxy.ts`) redirects mismatched users to the correct side. There is no automated reminder system in the current build.

The portal must feel premium and non-technical — MCR's word is "exclusive".

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
│       ├── 0001_initial_schema.sql
│       ├── 0002_portal_overhaul.sql
│       └── 0003_supabase_auth_clients.sql
├── .claude/
│   └── skills/
│       ├── new-migration/SKILL.md
│       ├── seed-client/SKILL.md
│       ├── classify-doc/SKILL.md
│       ├── smoke-test/SKILL.md
│       └── type-audit/SKILL.md
└── src/
    ├── app/
    │   ├── layout.tsx                        # Root layout
    │   ├── globals.css
    │   ├── (admin)/                          # Route group — MCR staff only
    │   │   ├── layout.tsx                    # Admin shell: sidebar, auth guard
    │   │   └── admin/
    │   │       ├── login/page.tsx            # Admin email + password sign-in
    │   │       ├── page.tsx                  # Dashboard overview
    │   │       └── clients/
    │   │           ├── page.tsx              # Client list + invite form
    │   │           └── [id]/
    │   │               └── page.tsx          # Client detail: docs + accountant
    │   ├── (portal)/                         # Route group — client session required
    │   │   ├── layout.tsx                    # Portal shell: branding only
    │   │   └── portal/
    │   │       ├── page.tsx                  # Session-gated upload wizard
    │   │       ├── login/page.tsx            # Client email + password sign-in
    │   │       ├── set-password/page.tsx     # First-visit password setup (post-invite)
    │   │       └── settings/page.tsx         # Account info (email view + password change)
    │   └── api/
    │       ├── admin/
    │       │   └── clients/
    │       │       ├── route.ts              # GET list, POST invite via Supabase Auth
    │       │       └── [id]/route.ts         # GET detail, PATCH update
    │       ├── portal/
    │       │   ├── me/route.ts               # GET — session-scoped client profile
    │       │   ├── upload/route.ts           # POST — receive file, store
    │       │   ├── accountant-details/route.ts
    │       │   └── ato-admin-confirm/route.ts
    │       ├── auth/
    │       │   └── callback/route.ts         # Exchange Supabase PKCE code → session
    │       └── classify-document/
    │           └── route.ts                  # POST — server-only Claude API call
    ├── components/
    │   ├── ui/                               # Primitive, reusable
    │   │   ├── Button.tsx
    │   │   ├── Badge.tsx
    │   │   ├── Card.tsx
    │   │   ├── Input.tsx
    │   │   ├── Progress.tsx
    │   │   └── Spinner.tsx
    │   ├── admin/
    │   │   ├── ClientTable.tsx               # Sortable client list
    │   │   ├── ClientsPageClient.tsx
    │   │   ├── InviteClientForm.tsx          # Add client + send Supabase invite
    │   │   ├── DocumentStatusGrid.tsx        # Doc checklist per client
    │   │   └── CompletenessBar.tsx           # Visual progress bar
    │   └── portal/
    │       ├── PortalHeader.tsx              # Branded header, settings, sign-out
    │       ├── PortalStepper.tsx             # Vertical step nav
    │       ├── CategoryUploadSection.tsx     # Drop zone for one doc category
    │       ├── AccountantDetailsForm.tsx
    │       └── ATOAdminConfirmation.tsx
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts                     # Browser Supabase client (singleton)
    │   │   └── server.ts                     # Server Supabase clients (service role + SSR auth)
    │   ├── auth/
    │   │   └── portal.ts                     # getPortalClient(): session → clients row
    │   ├── ai/
    │   │   ├── classify.ts                   # Orchestrates the classification pipeline
    │   │   └── prompts.ts                    # ALL Claude prompt templates
    │   ├── storage/
    │   │   └── upload.ts                     # Supabase Storage helpers
    │   ├── ocr/
    │   │   └── extract.ts                    # pdf-parse + Tesseract.js pipeline
    │   ├── constants.ts                      # Document categories, size limits
    │   └── utils.ts                          # cn(), formatBytes(), formatDate()
    ├── types/
    │   ├── database.ts                       # Supabase generated types (auto-generated)
    │   └── app.ts                            # Application-level interfaces
    └── proxy.ts                              # Next.js proxy: admin + portal auth guards
```

---

## Environment Variables

All required. Never expose server-only vars to the browser.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=            # https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= # anon/public key (browser-safe)
SUPABASE_SERVICE_ROLE_KEY=           # service_role key — SERVER ONLY

# AI
ANTHROPIC_API_KEY=                   # sk-ant-... SERVER ONLY, only in /api/classify-document

# App
NEXT_PUBLIC_APP_URL=                 # https://your-domain.vercel.app (no trailing slash)
```

**Non-negotiable security rules:**
- `SUPABASE_SERVICE_ROLE_KEY` must never appear in `src/components/` or `src/app/(portal)/`.
- `ANTHROPIC_API_KEY` must only appear in `src/app/api/classify-document/route.ts`.
- All file downloads use `createSignedUrl()` with ≤ 300s expiry — never `getPublicUrl()`.
- Client sessions are enforced server-side via `getPortalClient()` (see `src/lib/auth/portal.ts`). Never trust a `client_id` that comes from the request body.
- Admins must never reach client routes and vice-versa — enforced by `proxy.ts` using `app_metadata.role`.

---

## Supabase Dashboard Configuration

The invite flow requires three dashboard settings to be correct. Set these once per project:

1. **Site URL** (`Authentication → URL Configuration → Site URL`) — set to `NEXT_PUBLIC_APP_URL`.
2. **Redirect URLs** — add `${NEXT_PUBLIC_APP_URL}/api/auth/callback` to the allow list. Also add `http://localhost:3000/api/auth/callback` for local dev.
3. **Email templates** — customise the "Invite user" email at `Authentication → Email Templates → Invite user` if you want MCR branding; the default Supabase template also works.

For production, switch `Authentication → Email → SMTP Settings` to a real provider (Resend, SendGrid, SES) because the built-in Supabase SMTP has strict per-hour limits.

---

## Development Commands

```bash
npm run dev                                         # Start dev server (localhost:3000)
npm run type-check                                  # tsc --noEmit — MUST pass before marking any task complete
npm run lint                                        # ESLint — zero warnings in new files
npm run build                                       # Full production build
npm run test                                        # Vitest unit tests
npm run test:e2e                                    # Playwright end-to-end
```

Supabase CLI:
```bash
npx supabase start                                  # Start local stack
npx supabase db reset                               # Apply all migrations fresh
npx supabase migration new <name>                   # New migration file
npx supabase gen types typescript --local > src/types/database.ts  # Regenerate types
```

**Rule:** After every migration, regenerate types and commit both files together.

---

## Document Categories — Canonical Reference

Source of truth: `src/lib/constants.ts` (`DOCUMENT_CATEGORIES` / `CATEGORY_META`). Never use ad-hoc strings. The six categories are `current_financials`, `historical_financials`, `integrated_client_account`, `director_penalty_notices`, `trust_deed`, and `company_licences`. See `constants.ts` for the full metadata (accepted MIME types, labels, required vs optional).

---

## API Route Map

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/clients` | GET | Admin session | List all clients with doc counts |
| `/api/admin/clients` | POST | Admin session | Create client row + invite via Supabase Auth |
| `/api/admin/clients/[id]` | GET | Admin session | Single client with all docs |
| `/api/admin/clients/[id]` | PATCH | Admin session | Update client status |
| `/api/portal/me` | GET | Client session | Return current client profile, docs, accountant, ATO flag |
| `/api/portal/upload` | POST | Client session | Store file to Supabase Storage |
| `/api/portal/accountant-details` | GET / POST | Client session | Read / upsert current accountant info |
| `/api/portal/ato-admin-confirm` | POST | Client session | Mark ATO admin step complete |
| `/api/auth/callback` | GET | None | Exchange Supabase PKCE code for session cookie |
| `/api/classify-document` | POST | `x-internal-secret` header | Extract text → Claude API → return classification JSON |

---

## Key Rules

### Security
1. `SUPABASE_SERVICE_ROLE_KEY` — server-only. Zero tolerance elsewhere.
2. `ANTHROPIC_API_KEY` — only in `/api/classify-document/route.ts`.
3. File downloads: always `createSignedUrl()`, expiry ≤ 300s. Never `getPublicUrl()`.
4. Portal API routes resolve the client via `getPortalClient()` — they never accept a `client_id` from the request.
5. RLS enabled on every table.
6. The admin invite flow must (a) call `supabase.auth.admin.inviteUserByEmail`, (b) stamp `app_metadata.role = 'client'` on the new auth user, (c) insert the `clients` row with `auth_user_id` set. If (c) fails, the auth user is deleted to keep state consistent.

### Code Patterns
7. Service-role Supabase client (`getSupabaseServerClient`) for data operations in API routes; SSR auth client (`getSupabaseAuthClient`) only for reading the session. Browser client only for client-side auth + real-time.
8. All DB calls typed using generated `database.ts` types.
9. API routes return `{ error: string }` with correct HTTP status on failure.
10. File uploads stored at `documents/{client_id}/{uuid}.{ext}` in Supabase Storage.

### AI Integration
11. Claude model: `claude-sonnet-4-20250514`. Hardcode only in `lib/ai/prompts.ts` as `CLAUDE_MODEL` constant.
12. Store raw Claude response in `ai_raw_response jsonb` column for cost auditing.

### AI Confidence Thresholds
| Confidence | Action | UI Badge |
|---|---|---|
| ≥ 0.85 | Auto-classify | Green |
| 0.60–0.84 | Classify + flag | Amber |
| < 0.60 | Set unknown, needs_review | Red |

### Naming
13. API route directories: kebab-case. Filename: `route.ts`.
14. Components: PascalCase filename, named export.
15. Hooks: `use` prefix, camelCase.
16. DB columns: snake_case.

### Before Marking Any Task Complete
17. `npm run type-check` → zero errors.
18. `npm run lint` → zero errors in modified files.
19. If DB schema changed: regenerate `src/types/database.ts` and commit with migration.
20. If new env var added: add to `.env.example`.

---

## Database Schema

```sql
-- clients
id uuid PK, name text, email text UNIQUE,
status text CHECK (status IN ('invited','in_progress','complete','missing_items')),
auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
ato_admin_confirmed boolean DEFAULT false, ato_admin_confirmed_at timestamptz,
created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()

-- documents
id uuid PK, client_id uuid FK→clients,
file_path text, original_filename text, file_type text, file_size_bytes bigint,
doc_category text CHECK (doc_category IN ('current_financials','historical_financials',
  'integrated_client_account','director_penalty_notices','trust_deed','company_licences')),
ai_doc_type text, ai_financial_years text[], ai_confidence float, ai_raw_response jsonb,
extracted_text text,
status text CHECK (status IN ('uploaded','processing_text','ready','rejected')),
uploaded_at timestamptz DEFAULT now()

-- accountant_details
id uuid PK, client_id uuid FK→clients UNIQUE,
company_name text, contact_person text, phone_number text, email_address text,
created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()

-- document_chunks (pgvector for RAG)
id uuid PK, document_id uuid FK, client_id uuid FK,
chunk_index int, chunk_text text, embedding vector(1536), metadata jsonb,
created_at timestamptz DEFAULT now()
```

> **Note:** the `follow_ups` table and the `clients.magic_link_token` / `link_expires_at` columns were removed in migration `0003_supabase_auth_clients.sql`. Do not re-introduce them without a product-side decision.

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

*MCR Partners × Apex AI — Phase 1. Prepared 10 April 2026. Auth refactor 20 April 2026.*
