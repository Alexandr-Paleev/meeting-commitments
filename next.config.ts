import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev would otherwise write an AGENTS.md for coding agents; CLAUDE.md already points to
  // the docs in node_modules/next/dist/docs/.
  agentRules: false,
};

export default nextConfig;
