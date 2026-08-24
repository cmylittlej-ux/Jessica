import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources (exports -> ./src/index.ts).
  transpilePackages: [
    "@reos/db",
    "@reos/workflows",
    "@reos/ai",
    "@reos/shared",
    "@reos/domain",
    "@reos/audit",
  ],
};

export default nextConfig;
