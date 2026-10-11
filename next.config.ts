import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true }, // card images come from short-lived signed URLs
  // The niche pack (docs/PACKS.md): inlined at build time so browser code (packs/shared) reads the same pack as the
  // server. Unset = "unique-names".
  env: { NICHE: process.env.NICHE ?? "" },
};

export default nextConfig;
