import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js starts a worker from its own script file: it must not be bundled.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // Read from disk at run time, so tracing can't see these paths.
  outputFileTracingIncludes: {
    // The official ASIC form PDFs (src/lib/forms/fill.ts).
    "/api/admin/cvl/**": ["./src/lib/forms/templates/**/*"],
    // The print page fills each form in memory for its warnings and page count.
    "/cvl/**": ["./src/lib/forms/templates/**/*"],
    // Scanned statements (src/lib/scan): Tesseract's English model, with the
    // one route that reads scans and nothing else.
    "/api/admin/clients/[id]/scan-read": ["./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*"],
  },
};

export default nextConfig;
