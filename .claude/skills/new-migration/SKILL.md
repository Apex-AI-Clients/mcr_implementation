---
name: new-migration
description: Use when creating or modifying the Supabase database schema — adding tables, columns, or RLS policies for the MCR project.
---

# New Migration Workflow

Every schema change goes through a migration file. Follow all 6 steps — no shortcuts.

## Steps

**1. Create the migration file**
```bash
npx supabase migration new <descriptive-name>
# Creates: supabase/migrations/YYYYMMDDHHMMSS_descriptive-name.sql
```

**2. Write the migration SQL**
- Use `IF NOT EXISTS` / `IF EXISTS` for safety
- Use `text` + `CHECK` constraints — NOT PostgreSQL ENUM types (hard to migrate)
- Enable RLS immediately after every new table:
  ```sql
  ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
  ```
- Add `updated_at` trigger where needed:
  ```sql
  CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON <table_name>
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  ```

**3. Apply and verify locally**
```bash
npx supabase db reset
# No errors = migration is valid
```

**4. Regenerate TypeScript types**
```bash
npx supabase gen types typescript --local > src/types/database.ts
```

**5. Type check**
```bash
npm run type-check
# Must pass with zero errors
```

**6. Commit migration + types together**
```bash
git add supabase/migrations/ src/types/database.ts
git commit -m "feat(db): <what changed and why>"
```

## RLS Policy Templates

```sql
-- Service role full access (used by server-side code)
CREATE POLICY "Service role access" ON <table>
  USING (auth.role() = 'service_role');

-- Deny all anonymous reads
CREATE POLICY "No anon reads" ON <table>
  FOR SELECT USING (false);
```

## Common Mistakes
- Forgetting to enable RLS → table is publicly readable
- Using PostgreSQL ENUM types → painful rollbacks
- Not running `db reset` → migration untested
- Committing migration without updated `database.ts` → type errors
