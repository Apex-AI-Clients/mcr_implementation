import type { NextConfig } from "next";

// Scanned statements (src/lib/scan): Tesseract's English model ships with the
// app, read from disk at run time, so tracing can't see it.
const TESSERACT_MODEL = ["./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*"];

const nextConfig: NextConfig = {
  // tesseract.js starts a worker from its own script file: it must not be bundled.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // The official ASIC form PDFs are read from disk by the routes that fill
  // them (src/lib/forms/fill.ts); tracing can't see a runtime path.
  outputFileTracingIncludes: {
    "/api/admin/cvl/**": ["./src/lib/forms/templates/**/*"],
    // The print page fills each form in memory for its warnings and page count.
    "/cvl/**": ["./src/lib/forms/templates/**/*", ...TESSERACT_MODEL],
    // Pages and routes that read a client's statements (and so start a scan's reading).
    "/clients/**": TESSERACT_MODEL,
    "/api/admin/clients/**": TESSERACT_MODEL,
  },
};

export default nextConfig;
