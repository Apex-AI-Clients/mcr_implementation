This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Regenerating database types

After a migration, regenerate `src/types/database.ts` and commit it with the
migration. The file must be UTF-8: on Windows PowerShell, a plain `>` redirect
writes UTF-16, which ESLint reads as binary. Use:

```powershell
npx supabase gen types typescript --linked | Out-File -Encoding utf8 src/types/database.ts
```

(On macOS/Linux, `npx supabase gen types typescript --linked > src/types/database.ts` is fine.)

## Dependencies to watch by hand

- **SheetJS (`xlsx`)** reads uploaded Excel files on the Prediction Data page
  (`src/lib/sbr/import/parseUpload.ts`). It is installed from the official
  tarball, pinned to 0.20.3 with its integrity hash in `package-lock.json`,
  because the npm `xlsx` package stopped at 0.18.5, which has known
  vulnerabilities (CVE-2023-30533, CVE-2024-22363). Dependabot and `npm audit`
  do not track the tarball, so check https://cdn.sheetjs.com/ and
  https://docs.sheetjs.com/docs/getting-started/installation/nodejs for a newer
  release every few months, and after any SheetJS security advisory. To
  upgrade: `npm install --save-exact https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`,
  then `npm run test -- src/lib/sbr/import`.

## AI: Claude via OpenRouter

All AI calls go through `src/lib/ai/openrouterClient.ts` (`askClaude`). Every
request asks OpenRouter for Anthropic only, with no fallbacks, data
collection denied and zero data retention required; an answer from any other
provider is rejected, and the feature shows no AI text instead. Off unless
`AI_SUMMARIES_ENABLED=true` and `OPENROUTER_API_KEY` are set (Vercel only,
by the account owner).

What is sent, and only when staff open the page:

- Comparison summary: the confirmed key figures, as printed, per year. Not
  written while a total that does not add up is unticked (Needs review).
- Lodgement summary: the computed lodgement, DPN and debt figures (no CSV).
- Label suggestions: printed labels and their headings for the key figures
  the dictionary found no line for. No figures.

No PDF is sent to any model. Financial statements are read by our own code
(`src/lib/printed/`); director penalty notices too (`src/lib/dpn/`).

**Open (17 Oct 2026):** confirm OpenRouter's own terms (as the intermediary)
for ATO-derived figures with the company's AI team, and record what they
confirmed here.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
