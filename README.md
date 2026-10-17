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

## Open reminder: OpenRouter and ATO data

**Unconfirmed (17 Oct 2026):** whether OpenRouter, or the model provider behind
it, retains or trains on what we send has not yet been confirmed with the
company's AI team for ATO data. Until it is, keep what goes to it to a minimum:

- The AI summaries (lodgement analysis, financials comparison) are generated
  only when staff open those pages, never in an automatic run.
- Director penalty notices are never sent to any AI model. They are read with
  deterministic text parsing (`src/lib/dpn/`), in memory, on our own server.
- The financial statement extraction still sends statement PDFs to OpenRouter,
  as before.

Remove this section once the AI team has confirmed the terms, and record what
they confirmed.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
