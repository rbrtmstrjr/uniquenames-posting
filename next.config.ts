import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true }, // card images come from short-lived signed URLs
  // The niche pack (docs/PACKS.md): inlined at build time so browser code (packs/shared) reads the same pack as the
  // server. Unset = "unique-names".
  env: { NICHE: process.env.NICHE ?? "" },
  // The names PDF (Names > Export PDF): pdfkit loads from node_modules at run time (it reads its own data files), and
  // the committed OFL fonts ship with the route that draws the PDF.
  serverExternalPackages: ["pdfkit"],
  // The shop's download route (docs/SHOP.md) draws the same PDF.
  outputFileTracingIncludes: { "/names/export": ["./lib/pdf/fonts/**/*"], "/shop/download/[token]": ["./lib/pdf/fonts/**/*"] },
};

export default nextConfig;
