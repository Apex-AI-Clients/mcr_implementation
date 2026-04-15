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
- [ ] "Add Client" form: submit name + email → row appears in table
- [ ] Click into a client → document status grid shows 8 empty slots
- [ ] "Send Reminder" button fires → check `follow_ups` table for new row

## Portal Flow

- [ ] `http://localhost:3000/portal/test-token-dev-abc123` — loads with client name
- [ ] Document checklist shows all 8 required documents as missing (red)
- [ ] Upload a PDF → progress indicator appears
- [ ] After upload: file appears in list, checklist updates
- [ ] Check `documents` table: row exists with `status = 'processing'` initially
- [ ] After classification: row updates with `ai_doc_type` and `ai_confidence`
- [ ] Upload 60MB file → rejected with size error message
- [ ] Upload `.exe` file → rejected with type error message

## Token Validation

- [ ] `http://localhost:3000/portal/token-expired-004` → expired error page shown
- [ ] Completely random token → 404 or error page
- [ ] After using a valid token once → same token shows error on second visit

## API Endpoint Checks

```bash
# Valid token
curl "http://localhost:3000/api/portal/validate-token?token=test-token-dev-abc123"

# classify-document rejects unauthenticated
curl -X POST http://localhost:3000/api/classify-document \
  -H "Content-Type: application/json" \
  -d '{"text":"test","filename":"test.pdf"}'
# Expected: 403

# Cron without secret
curl http://localhost:3000/api/cron/send-reminders
# Expected: 401
```

## Build Verification

```bash
npm run type-check   # Zero errors
npm run lint         # Zero errors
npm run build        # Must succeed without warnings
```
