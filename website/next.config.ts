import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Ensure proper routing
  trailingSlash: false,
};

export default nextConfig;
