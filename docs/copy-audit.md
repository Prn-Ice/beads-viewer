# Copy audit

Before/after for every user-facing string rewritten in the in-app copy pass
(bead `view-beads-yps`). Rules: plain English, concrete verbs, no internal
jargon; short sentences that say what the thing is and why it matters.
Accessible labels were audited separately and kept descriptive.

## Unblocks disclosure (issue drawer, Dependencies tab)

| Before | After |
| --- | --- |
| Snapshot estimate from the current dependency graph, not a reservation. Up to 25 direct dependents are checked against the installed bd readiness semantics. | An estimate of what finishing this issue would unblock, based on the current issue links. Checks up to 25 issues that directly depend on this one. |
| Loading estimate... | Checking what this would unblock... |
| X likely ready after completion · Y need verification · Z not unblocked by this issue | X would become ready · Y need a manual check · Z would not change |
| Likely ready after completion / Needs verification / Not unblocked by this issue | Would become ready / Needs a manual check / Would not change |
| No direct dependents to estimate. | No issues directly depend on this one. |
| N more dependents omitted by the candidate limit. | Only the first 25 dependents are shown; N more are not listed. |
| Records could not be loaded for: ... | Could not load details for: ... |
| failed to load unblock estimate (HTTP 500) | Couldn't load the unblock estimate (HTTP 500). |
| Likely ready after completion. | Would become ready. |
| Already ready — completing this issue adds nothing. | Already ready. |
| Already closed — not open work. | Already closed. |
| bd ready --explain reports this issue as both ready and blocked. | bd reports this issue as both ready and blocked; check manually. |
| Root issue status is closed; completing it is not actionable right now. | This issue is closed, so finishing it can't unblock anything right now. |
| The project has N dependency cycle(s); estimates need manual verification. | The dependency graph has N cycle(s), so estimates can't be trusted; check manually. |
| bd ready --explain is unavailable; estimates need manual verification. | Readiness data isn't available; estimates need a manual check. |
| Full issue record could not be loaded. | Couldn't load this issue's details; check manually. |
| Not reported as blocked by bd ready --explain. | bd doesn't report it as blocked; check manually. |
| Blocker details are missing from bd ready --explain. | bd doesn't say what's blocking it; check manually. |
| Blocked per bd ready --explain, but no blocker is listed. | bd says it's blocked but doesn't list the blockers; check manually. |
| bd ready --explain blocker details are inconsistent. | bd's blocker details don't add up; check manually. |
| Root status is X in its record but Y in the readiness snapshot. | This issue's status doesn't match between bd's data sources (X vs Y); check manually. |
| Issue is pinned, a template, or ephemeral — not ordinary work. | This is a pinned, template, or ephemeral issue, not regular work; check manually. |
| Issue type epic is not ordinary work. | Its type (epic) isn't regular work; check manually. |
| defer_until is not a valid timestamp. | It has an invalid defer date; check manually. |
| Dependency counts are missing from the candidate record. | Its dependency list is missing; check manually. |
| Only 1 of 4 dependencies were loaded. | Only 1 of 4 dependencies could be loaded; check manually. |
| Dependency count disagrees with the loaded dependencies. | Its dependency count doesn't match the loaded list; check manually. |
| The root's blocking edge is not visible from the candidate record. | Its record doesn't show this issue blocking it; check manually. |
| Root relationship type is parent-child, not blocks. | Its link to this issue is parent-child, not a blocking link; check manually. |
| Another blocks dependency (id) is open. | Also blocked by id (open). |
| Parent/child relationship to id needs verification. | Linked to id as parent/child; check manually. |
| Relationship type waits-for needs verification. | Linked to id as waits-for; check manually. |

## Needs you inbox (sidebar)

| Before | After |
| --- | --- |
| Open issues labelled human and ready per bd, across all discovered projects. Checked once on open; refresh manually. | Issues labelled human and ready to start, from all your projects. Loaded when you open this; use Refresh to update. |
| Snapshot 14:32 | As of 14:32 |
| Refreshing snapshot... | Refreshing... |
| failed to load needs you (HTTP 500) | Couldn't load the needs-you list (HTTP 500) |
| Could not refresh the data cache | Couldn't refresh the data |
| Showing the previous snapshot. | Showing the last result. |
| N projects could not be checked. | Could not check N projects. |
| Badge aria: Snapshot refresh failed | Badge aria: Refresh failed |
| Badge aria: Incomplete count | Badge aria: Count may be incomplete |

## Needs attention panel

| Before | After |
| --- | --- |
| Stale urgent or long-stuck issues on this board | Urgent issues that went quiet, or in-progress work that is stuck. |
| Inactive 6 days since Sep 1 — urgent (P0/P1), threshold 3 days | Quiet for 6 days (since Sep 1) — urgent issues (P0/P1) are flagged after 3 days |
| Inactive 20 days — possibly stalled (in progress), threshold 14 days | Quiet for 20 days (since …) — in-progress issues are flagged after 14 days |
| Urgent (P0/P1) stale after / In progress stalled after | Urgent issues (P0/P1) are flagged after / In-progress issues are flagged after |
| Thresholds apply to this session only. | These limits are not saved. |

## Session changes (sidebar)

| Before | After |
| --- | --- |
| Baseline: 14:32 | Changes since 14:32 |
| No observed changes. | No changes seen. |
| Reset baseline | Reset |

## Blocker chains (issue drawer)

| Before | After |
| --- | --- |
| Only explicit blocks links are followed; other types are listed separately. This is not a readiness calculation. Up to N hops, N distinct issues and N rows per direction. | Follows blocking chains up to N steps — at most N distinct issues and N rows per side. Other link types are listed, not followed. |
| Loading relationships... | Loading chains... |
| Retry relationships | Retry |
| Issue load limit reached. Open an issue to explore from there. | Load limit reached — open an issue above to keep exploring. |
| Unresolved reference | Unknown issue |
| blocks / closed issue, historical link | blocks / blocking issue is closed |
| / reference shown above | / listed above |
| Depth limit reached. | Stops here — open an issue above to go deeper. |
| No further blocks links returned. | No further blocking links. |
| More links omitted by the row limit. | More rows not shown (row limit). |
| Some relationship data is missing; this chain may be incomplete. | Some links could not be loaded — this chain may be incomplete. |
| Other relationships (not followed): / More relationships omitted. | Other links (not followed): / More links not shown. |
| Issue unavailable or failed to load | Couldn't load this issue |

## Dependency graph (issue drawer)

| Before | After |
| --- | --- |
| Explore relationships around this issue: up to N hops, N issues and N edges. Expand nodes to load more, or select one to open its details. | Shows the issues linked to this one, up to N steps out, N issues and N connections. Expand a node to load its links, or select one to open the issue. |
| Loading full relationships... | Loading links... |
| Arrows point from the dependent to its prerequisite. | The arrow points from the blocked issue to the one blocking it. |
| Dashed lines mark associations, not ordinary blockers. | Dashed lines mark non-blocking links. |
| Dotted gray lines mark conditional or unknown relationship types. | Dotted gray lines mark conditional or unknown link types. |
| Closed neighbors and unresolved targets are terminal. Open a closed issue as the root to explore its history. | Closed neighbors and unknown targets stop the graph. Open a closed issue to explore its history. |
| Hover or focus an edge to read its type label. | Hover or focus a connection to see its type. |
| Unresolved reference | Unknown issue |
| Directed cycles are marked; each issue is visited once. | Loops are marked; each issue appears once. |
| More nodes omitted by the 30-node limit. | Only the first 30 issues are shown. |
| More edges omitted by the 40-edge limit. | Only the first 40 connections are shown. |
| Some relationship data is missing; the graph may be incomplete. | Some links could not be loaded — the graph may be incomplete. |
| N nodes can be expanded one more hop. | N issues can be expanded one more step. |
| List view (N nodes, M edges) | List view (N issues, M connections) |
| Direct-child hierarchy is shown in full within the node limit. Expand a child to load its connections inside this epic. Outside neighbors are omitted. | All direct children are shown, up to the N-issue limit. Expand a child to see its links within this epic. Links outside the epic are hidden. |
| Issue load limit reached. Open an issue to explore from there. | Load limit reached — open an issue above to keep exploring. |
| Parent epic unavailable or failed to load. | Couldn't load the parent epic. |
| Issue unavailable or failed to load | Couldn't load this issue |
| failed to load children (HTTP 500) | Couldn't load children (HTTP 500) |

## Issue drawer

| Before | After |
| --- | --- |
| failed to load issue (HTTP 500) | Couldn't load this issue (HTTP 500) |
| Unresolved reference | Unknown issue |
| Expand blocker chains to load relationship details. | Open "Explore blocker chains" to load these links. |

## Board and dashboard

| Before | After |
| --- | --- |
| failed to load issues (HTTP 500) | Couldn't load issues (HTTP 500) |
| failed to load children (HTTP 500) (epic progress) | Couldn't load children (HTTP 500) |
| request failed (GitHub repo row) | couldn't fetch |

## Sidebar projects

| Before | After |
| --- | --- |
| bd status failed for this project (tooltip + aria) | bd could not read this project |

## GitHub repo settings

| Before | After |
| --- | --- |
| failed to load settings | Couldn't load the repo list |
| failed to save | Couldn't save your changes |

## Audited, no change needed

`bin/view-beads.mjs` output, `src/app/layout.tsx` metadata, filters sheet,
theme switcher, badges, parent-link chips, issue search/scope toggles — all
already plain and direct.
