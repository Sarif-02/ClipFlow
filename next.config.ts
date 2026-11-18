import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: { incomingRequests: { ignore: [/\/api\/oauth\/.*\/callback/] } },
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./.env*"] },
};

export default nextConfig;
