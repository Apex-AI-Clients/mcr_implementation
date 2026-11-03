import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The official ASIC form PDFs are read from disk by the routes that fill
  // them (src/lib/forms/fill.ts); tracing can't see a runtime path.
  outputFileTracingIncludes: {
    "/api/admin/cvl/**": ["./src/lib/forms/templates/**/*"],
    // The print page fills each form in memory for its warnings and page count.
    "/cvl/**": ["./src/lib/forms/templates/**/*"],
  },
};

export default nextConfig;
