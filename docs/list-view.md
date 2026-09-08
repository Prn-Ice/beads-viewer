# List View

A compact table view that shows the same board issues as rows instead of
columns. Use the small **Board / List** toggle above the board to switch. The
toggle and any chosen sort are session state — they reset on reload and do not
touch the URL, so deep links and the polling refresh contract stay unchanged.

The **Needs attention** panel stays available in both views, and both views use
the exact same issue data (so project, search, and Open/All scope narrow the
list too). Clicking a row's title opens the same issue drawer.

## Columns

Each row shows: **ID, Title, Priority, Status, Type, Assignee, Age** (from
`created_at`). Reused badges render priority, status, and type; age uses the
same relative-time formatting as the board cards.

## Sorting

Sorting is deterministic: sort by the chosen column, then by issue ID to break
ties.

- **Desktop** — each column header is a native button; clicking cycles
  ascending → descending → ascending. The active header shows an arrow and the
  `th` carries `aria-sort`.
- **Mobile** — an accessible labeled **Sort by** select picks the column and a
  direction button toggles ascending/descending. The table scrolls horizontally
  on narrow screens instead of hiding the sort controls.

The default is Age ascending (creation date, oldest first). Issues with a missing
value, invalid date, or blank assignee sort **last** in both directions rather
than being dropped or silently assumed. Long lists scroll within the viewport
with column headers pinned; the toolbar and mobile sort controls remain visible.

## Files

- `src/lib/list-sort.ts` — pure sorting logic + unit tests (`list-sort.test.ts`)
- `src/components/issue-list.tsx` — table view component
- `src/components/board.tsx` — owns the Board/List toggle and sort state
- `tests/e2e/list-view.spec.ts` — Playwright coverage

## Screenshots

![List view on desktop](screenshots/list-view-desktop.png)

![List view on mobile](screenshots/list-view-mobile.png)
