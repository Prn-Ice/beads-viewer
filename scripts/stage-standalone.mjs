// Stage the static assets the standalone server does not copy on its own.
// Per the Next.js docs: `public` and `.next/static` must be copied into
// `.next/standalone/` manually, after which server.js serves them.
import { cpSync } from "node:fs";

cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
