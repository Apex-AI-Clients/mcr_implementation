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

## Quick Seed — Single Client (Portal Testing)

Run in Supabase Studio (http://localhost:54323) SQL editor or `npx supabase db shell`:

```sql
INSERT INTO clients (
  id, name, email, status, magic_link_token, link_expires_at
) VALUES (
  gen_random_uuid(),
  'Acme Pty Ltd (TEST)',
  'test@example.com',
  'invited',
  'test-token-dev-abc123',
  now() + interval '15 days'
)
ON CONFLICT (email) DO UPDATE SET
  magic_link_token = 'test-token-dev-abc123',
  link_expires_at  = now() + interval '15 days',
  status           = 'invited';
```

Portal URL: `http://localhost:3000/portal/test-token-dev-abc123`

## Seed Multiple Clients (Admin Dashboard Testing)

```sql
INSERT INTO clients (name, email, status, magic_link_token, link_expires_at) VALUES
  ('Acme Pty Ltd',   'acme@example.com',  'in_progress', 'token-acme-001',    now() + interval '15 days'),
  ('Smith & Sons',   'smith@example.com', 'invited',     'token-smith-002',   now() + interval '10 days'),
  ('Greenfield Co',  'green@example.com', 'complete',    'token-green-003',   now() + interval '5 days'),
  ('Expired Corp',   'old@example.com',   'invited',     'token-expired-004', now() - interval '1 day');
```

## Seed an Expired Token (Error State Testing)

The `Expired Corp` row above has `link_expires_at` in the past — use `token-expired-004` to test the expired link error page.

## Reset All Test Data

```sql
DELETE FROM follow_ups WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@example.com');
DELETE FROM documents   WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@example.com');
DELETE FROM clients     WHERE email LIKE '%@example.com';
```

## After Seeding

- Admin dashboard: http://localhost:3000/admin
- Test client portal: http://localhost:3000/portal/test-token-dev-abc123
- Expired token: http://localhost:3000/portal/token-expired-004
