# view-beads

A local web dashboard for [beads](https://github.com/steveyegge/beads) (`bd`)
issue trackers. Run `view-beads` in any folder, get a link, open it in your
browser.

Built with Next.js, shadcn/ui and Tailwind. All data comes from the `bd` CLI.

![Board (dark)](docs/screenshots/beads-board-dark.png)

## Install

```sh
# from this flake
nix run github:Prn-Ice/beads-viewer

# or add it to your home-manager packages
inputs.view-beads.packages.x86_64-linux.default
```

Requires `bd` (the `beads` package) — the nix package pulls it in
automatically.

## Usage

```sh
cd ~/Projects/my-project
view-beads            # starts the server and opens the browser
view-beads --no-open  # only print the link
```

The server keeps running in the background. Running `view-beads` again reuses
it and just re-opens the browser.

### Which projects are shown?

Every beads project found on your machine, in this order:

1. The project in your current folder (or any parent folder)
2. Workspaces registered in `~/.beads/registry.json`
3. Any folder containing `.beads` under `~/Projects` or `~/Dotfiles`
   (3 levels deep)

Override the search roots with `BEADS_PROJECT_ROOTS=/path/a,/path/b`.

View Beads is an independent dashboard, not an official Beads product.
See [asset sources and licenses](public/brand/README.md) for branding credits.

## Development

```sh
nix develop       # node, git, playwright with browsers
npm run dev       # dev server on http://localhost:3000
npm test          # unit tests (vitest)
npm run test:e2e  # integration tests (playwright)
npm run lint      # eslint
npm run build     # production build (.next/standalone)
```

Environment variables: `BEADS_BIN` (path to `bd`), `BEADS_HOME` (where
`registry.json` lives), `BEADS_PROJECT_ROOTS`, `VIEW_BEADS_SERVER` (built
`server.js`), `VIEW_BEADS_NO_OPEN`.

## Architecture

- `src/lib/bd.ts` — spawns `bd --json`, the only data access
- `src/lib/discovery.ts` — finds beads projects
- `src/lib/cache.ts` — small TTL cache over `bd` output
- `src/app/api/*` — thin JSON endpoints
- `src/components/*` — board, sidebar, issue drawer
- `bin/view-beads.mjs` — CLI wrapper
