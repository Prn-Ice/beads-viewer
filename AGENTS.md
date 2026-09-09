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
- **Accessibility is a requirement.** Everything must work with keyboard
  navigation and screen readers. Most of this comes for free from shadcn/ui
  primitives — keep custom controls on native elements (`button`, `a`) and
  give icons/inputs accessible names.
- **Documentation matters.** Simple, human-readable, straight to the point.
  README and docs are part of the deliverable, and should be accompanied by
  screenshots of the UI.

## Fast Task Handoff

For implementation work, the primary agent delegates ready beads tasks to
`implementer`. Use at most two workers, each in a separate Git worktree, and only
parallelize independent changes. Each handoff includes task ID, absolute worktree
path, branch/base commit, E2E_PORT, scope, acceptance criteria, and known failures.
Mark tasks in progress in the main tracker before handing them off. Never run
concurrent implementation agents against the same working tree or test ports.

The implementer writes code and runs focused checks; it does not commit or close
tasks. The primary agent takes a quick pass over the diff and test results, fixes
any gaps itself, and verifies affected behavior. Do not bounce fixes through
repeated handoffs or silently accept failing checks.

Integrate serially: review/fix/test in the worker's worktree, commit only intended
files there, then cherry-pick that commit into main and verify the combined result
before closing the task. The primary agent owns all tracker mutations and Git
integration. This workflow authorizes per-task and workflow-setup commits, not
automatic pushes. If blocked, leave the task open and report the blocker. The
implementer follows its own instructions, not this delegation loop.

See [worker setup](docs/workers.md) for worktree preparation and test ports.

## Architecture

- `src/lib/bd.ts` — spawns `bd --json`, parses output (all data access)
- `src/lib/discovery.ts` — finds beads projects (cwd walk-up, registry, scan roots) and flags git worktrees (`.git` is a file); the sidebar groups those under **Worktrees**
- `src/lib/github.ts` — mirrors GitHub beads repos as sparse clones (auth via `gh`)
- `src/lib/config.ts` — local config file (repo selection), read per request, atomic writes
- `src/lib/cache.ts` — tiny TTL cache for bd output
- `src/app/api/*` — JSON endpoints; no DB, thin wrappers over `bd`
- `src/app/page.tsx` + `src/components/*` — client UI (sidebar, board, drawer)
- `bin/view-beads.mjs` — CLI: start/reuse server, print link, open browser

The dashboard polls projects and the selected board every 3 seconds while visible,
pauses polling in hidden tabs, and refreshes on return. These endpoints use a
1-second data cache. Open issue drawers do not poll.

`bd` binary location is resolved via `BEADS_BIN` env (default: `bd` from
PATH). Project discovery roots come from `BEADS_PROJECT_ROOTS` (comma
separated, default: cwd, `~/Projects`, `~/Dotfiles`).

Repos listed in `BEADS_GITHUB_REPOS` (comma separated `owner/repo`) — or, when
that env var is unset, selected via the settings panel and persisted to the
local config file (see `src/lib/config.ts`) — are mirrored as shallow sparse
clones of `.beads/` under `~/.cache/view-beads/github`
(`BEADS_GITHUB_CACHE`), authenticated per-invocation via `gh auth token`
(`GH_BIN` override) passed as a Basic `http.extraheader` (GitHub's git
endpoint rejects Bearer; `GIT_TERMINAL_PROMPT=0` keeps git from ever
prompting), re-fetched at most every 60s, and served per repo by
`GET /api/github/repos/[slug]` (slugs come from `GET /api/github/repos`).
Since git only syncs the JSONL exports, the clone gets a local database via
`bd init --skip-agents --skip-hooks` + `bd import` on first sync, upserted
whenever a re-fetch brings new commits. The clone is a strictly read-only
mirror: the `sync.remote` line `bd init` wires back at the GitHub repo is
stripped from its `config.yaml`, and nothing is ever pushed. `/api/projects`
stays local-only so it never blocks on syncs; the dashboard loads repos
sequentially into a GitHub sidebar group with per-repo loading rows. Repos
without `.beads` or without any synced issue data are skipped.
