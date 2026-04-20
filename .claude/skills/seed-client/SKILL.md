---
name: seed-client
description: Use when creating test client records in the local Supabase database for development and testing the portal, upload flow, or admin dashboard.
---

# Seed Client for Development

Creates realistic test records so you can test the full portal and admin flow locally without real client data.

## Prerequisites
```bash
npx supabase start   # Must be running
```

## Quick Seed — Single Client via Admin API

The easiest way is through the admin panel at `http://localhost:3000/admin/clients`:
1. Sign in as admin
2. Use the "Add New Client" form with a test email
3. Supabase Auth sends the invite email automatically

## Quick Seed — Single Client via SQL + Auth

If you need direct DB access, first create a Supabase Auth user, then link it:

```sql
-- Step 1: Create auth user via Supabase Dashboard (Authentication → Users → Invite User)
-- Or use the admin API: supabase.auth.admin.inviteUserByEmail('test@example.com')

-- Step 2: Insert client row (replace AUTH_USER_ID with the UUID from step 1)
INSERT INTO clients (
  id, name, email, status, auth_user_id
) VALUES (
  gen_random_uuid(),
  'Acme Pty Ltd (TEST)',
  'test@example.com',
  'invited',
  'AUTH_USER_ID'
)
ON CONFLICT (email) DO UPDATE SET
  status = 'invited';
```

Portal URL: `http://localhost:3000/portal/login`

## Seed Multiple Clients (Admin Dashboard Testing)

```sql
-- NOTE: Each client needs a corresponding auth.users row with auth_user_id linked.
-- Use the admin panel "Add Client" form for the simplest workflow.
INSERT INTO clients (name, email, status) VALUES
  ('Acme Pty Ltd',   'acme@example.com',  'in_progress'),
  ('Smith & Sons',   'smith@example.com', 'invited'),
  ('Greenfield Co',  'green@example.com', 'complete');
```

## Reset All Test Data

```sql
DELETE FROM accountant_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@example.com');
DELETE FROM documents WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@example.com');
DELETE FROM clients WHERE email LIKE '%@example.com';
-- Also delete corresponding auth.users via Supabase Dashboard → Authentication → Users
```

## After Seeding

- Admin dashboard: http://localhost:3000/admin
- Client portal login: http://localhost:3000/portal/login
- Client settings: http://localhost:3000/portal/settings
