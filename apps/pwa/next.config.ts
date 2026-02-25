import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.join(__dirname, "../..");
const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingRoot: isVercel ? __dirname : workspaceRoot,
  turbopack: {
    root: isVercel ? __dirname : workspaceRoot,
  },
};

export default nextConfig;
