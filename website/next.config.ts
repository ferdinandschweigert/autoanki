import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas', 'anki-apkg-export', 'sql.js'],
};

export default nextConfig;
