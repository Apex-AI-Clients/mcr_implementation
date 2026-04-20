---
name: smoke-test
description: Use before any Vercel deployment, after a significant refactor, or when debugging an issue spanning multiple systems (DB, storage, AI, email).
---

# Smoke Test Checklist

## Prerequisites

```bash
npx supabase start   # Local Supabase must be running
npm run dev          # Dev server on :3000
```

Seed test data first using the `seed-client` skill.

---

## Admin Flow

- [ ] `http://localhost:3000/admin` — loads without errors
- [ ] Client table shows seeded clients with correct status badges
- [ ] "Add Client" form: submit name + email → row appears in table, Supabase sends invite email
- [ ] Click into a client → document status grid shows 6 category slots

## Portal Flow

- [ ] Sign in at `http://localhost:3000/portal/login` with test client email + password
- [ ] Document checklist shows all 6 document categories
- [ ] ATO admin confirmation step works
- [ ] Accountant details form saves
- [ ] Upload a PDF → progress indicator appears
- [ ] After upload: file appears in list, checklist updates
- [ ] Check `documents` table: row exists with `status = 'ready'`
- [ ] Upload 60MB file → rejected with size error message
- [ ] Upload `.exe` file → rejected with type error message

## Auth Flow

- [ ] `/portal/login` — login form renders
- [ ] `/portal/set-password` — accessible after invite link click
- [ ] `/portal/settings` — shows signed-in email; password field is masked
- [ ] Sign out (from portal header) → redirected to `/portal/login`
- [ ] Unauthenticated `/portal` access → redirected to `/portal/login`
- [ ] Client session on `/admin` → redirected to `/portal`
- [ ] Admin session on `/portal` → redirected to `/admin`

## API Endpoint Checks

```bash
# Portal me (requires session)
curl http://localhost:3000/api/portal/me
# Expected: 401 without session

# Upload without session
curl -X POST http://localhost:3000/api/portal/upload
# Expected: 401
```

## Build Verification

```bash
npm run type-check   # Zero errors
npm run lint         # Zero errors
npm run build        # Must succeed without warnings
```
