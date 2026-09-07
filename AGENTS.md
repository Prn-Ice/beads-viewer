<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# view-beads

Local web dashboard for [beads](https://github.com/steveyegge/beads) (`bd`)
issue trackers. Type `view-beads` in any folder and get a link to open in your
browser. Supports multiple beads projects out of the box.

Stack: Next.js (App Router) + shadcn/ui + Tailwind v4. Data comes from the
`bd` CLI via subprocess — no database access is implemented here.

## Development

All tooling comes from the nix flake:

```bash
nix develop          # enter shell with node, git, etc.
npm run dev          # Next dev server (http://localhost:3000)
npm run build        # production build (.next/standalone)
npm run lint         # eslint
npm test             # vitest unit tests
npm run test:e2e     # Playwright integration tests (needs `npm run build` first)
```

## Rules

- **Conventional commits** are mandatory: `feat:`, `fix:`, `refactor:`,
  `test:`, `docs:`, `chore:`, `build:` — one-line subject, lowercase, no
  trailing period.
- **Keep code simple.** Prefer boring constructs (for loops, if statements,
  plain functions) over clever abstractions. An abstraction or library only
  earns its keep if it removes real duplication or complexity.
- **User journeys need integration tests.** Cover the main flows (view
  projects → board → issue detail) with Playwright tests. Unit tests are for
  pure logic that earns them (discovery, parsing, bucketing).

## Architecture

- `src/lib/bd.ts` — spawns `bd --json`, parses output (all data access)
- `src/lib/discovery.ts` — finds beads projects (cwd walk-up, registry, scan roots)
- `src/lib/cache.ts` — tiny TTL cache for bd output
- `src/app/api/*` — JSON endpoints; no DB, thin wrappers over `bd`
- `src/app/page.tsx` + `src/components/*` — client UI (sidebar, board, drawer)
- `bin/view-beads.mjs` — CLI: start/reuse server, print link, open browser

`bd` binary location is resolved via `BEADS_BIN` env (default: `bd` from
PATH). Project discovery roots come from `BEADS_PROJECT_ROOTS` (comma
separated, default: cwd, `~/Projects`, `~/Dotfiles`).
