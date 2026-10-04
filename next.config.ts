import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true }, // card images come from short-lived signed URLs
};

export default nextConfig;
