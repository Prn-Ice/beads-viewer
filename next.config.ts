import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      ".git/**/*",
      ".beads/**/*",
      "docs/**/*",
      "tests/**/*",
      "test-results/**/*",
      "AGENTS.md",
      "CLAUDE.md",
      "LICENSE",
      "README.md",
      "bin/*",
      "components.json",
      "eslint.config.mjs",
      "flake.lock",
      "flake.nix",
      "next.config.ts",
      "next-env.d.ts",
      "opencode.json",
      "package-lock.json",
      "playwright.config.ts",
      "postcss.config.mjs",
      "scripts/*",
      "tsconfig.json",
      "tsconfig.tsbuildinfo",
      "vitest.config.ts",
    ],
  },
};

export default nextConfig;
