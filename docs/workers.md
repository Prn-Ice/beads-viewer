# Two-Worker Development

Use the same `implementer` subagent twice, not a swarm. The primary agent assigns
independent tasks and reviews/integrates one result at a time. Keep overlapping
navigation, drawer, and data-contract changes serial unless boundaries are clear.

## Worktrees

Run from the main checkout:

```sh
bd worktree create ../beads-viewer-worker-1 --branch worker/1
bd worktree create ../beads-viewer-worker-2 --branch worker/2
```

Beads discovers the shared tracker through Git's common directory. Do not run
`bd init` in workers. The primary agent alone claims/closes issues and changes
dependencies. Run tracker mutations from main, not concurrently in workers.

Each worker needs its own `npm ci` inside `nix develop`; do not symlink
`node_modules` or `.next` between worktrees. The parent supplies absolute paths
in handoffs because a subagent may start with the main checkout as its cwd.

## Test Ports

| Checkout | E2E_PORT | Reserved Ports |
| --- | --- | --- |
| Main | 8455 (default) | 8455-8464 |
| Worker 1 | 8555 | 8555-8564 |
| Worker 2 | 8655 | 8655-8664 |

In worker 1 (use 8655 in worker 2):

```sh
nix develop --command npm ci
nix develop --command env E2E_PORT=8555 npm run test:e2e
nix develop --command npm test
nix develop --command npm run lint
```

Playwright builds and starts its own server and refuses to reuse an existing
one. The CLI test uses E2E_PORT + 5, private PID files, and cleans up only its own
children. Occupied ports fail instead of killing an unrelated service. Never run
two builds or test suites inside the same checkout. Lint runs after Playwright.
If memory is tight, serialize production builds even with independent worktrees.

## Handoff and Integration

Include the task ID, worktree path, branch/base commit, port, scope/acceptance
criteria, and known failures in each handoff. Workers leave changes uncommitted
and return touched files and exact check results. They do not mutate the tracker.

The primary agent reviews the diff, fixes gaps directly, verifies the task, and
commits intended files in that worktree. Cherry-pick into main serially, recheck
the combined behavior, then close the task. Do not push without a user request.
Shared snapshots and tests can conflict even when feature code does not; resolve
them during integration and regenerate only the affected screenshots.

Before reusing a worker, confirm it has no uncommitted or unmerged work, then
fast-forward its branch from main (`git merge --ff-only main`). If that cannot
fast-forward, keep the old branch and create a fresh task branch from main;
never reset or discard worker changes to make reuse easier.
