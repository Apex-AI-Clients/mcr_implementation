---
name: type-audit
description: Use before marking any task complete, after DB schema changes, or when TypeScript errors appear. Ensures type safety and catches security leaks.
---

# Type Audit

Run these in order before marking any task complete.

## Required Commands

```bash
# 1. Regenerate types if schema changed
npx supabase gen types typescript --local > src/types/database.ts

# 2. Type check — zero errors required
npm run type-check

# 3. Lint — zero errors in new/modified files
npm run lint
```

## Security Grep Checks

Run after every code change. Any match outside the allowed location is a bug.

```bash
# Must only appear in src/app/api/classify-document/route.ts
grep -r "ANTHROPIC_API_KEY" src/

# Must never appear in components or portal routes
grep -r "SUPABASE_SERVICE_ROLE_KEY" src/components/ src/app/\(portal\)/

# Must never be used — use createSignedUrl instead
grep -r "getPublicUrl" src/
```

## Common Type Errors After Schema Changes

| Error | Fix |
|---|---|
| `Property 'X' does not exist on type 'Row'` | Regenerate `database.ts` |
| `Type 'string' is not assignable to type 'DocStatus'` | Import type from `src/types/app.ts` |
| `Object is possibly undefined` | Add null check — never use `!` without a comment explaining why |

## Checklist

- [ ] `npm run type-check` → zero errors
- [ ] `npm run lint` → zero errors
- [ ] No `ANTHROPIC_API_KEY` outside classify-document route
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` in client components or portal
- [ ] No `getPublicUrl` calls anywhere
- [ ] If DB schema changed: `database.ts` regenerated and committed with migration
- [ ] If new env var added: added to `.env.example`
