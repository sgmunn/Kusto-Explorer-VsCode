# Results badge consistency

## Brief and decisions

Confirmed: the Results view badge sometimes stays on the previous result when
switching results, particularly when the next result has no rows.

Preserve the existing meaning: the badge counts rows across all tables in the
displayed result set. An empty result resets the count to zero. Query errors use
the existing error badge. This is a routine bug fix within the current results
workflow; no new product decisions are required.

## Acceptance criteria

- Switching populated results updates the count to the new result.
- Switching to zero rows or no tables replaces the previous count/error with zero.
- Normal display and recovery after a webview failure apply identical badge state.
- A delayed display retry cannot restore a badge from an older result.
- A later populated result restores its own count.
- Existing query, chart, and result display behavior remains intact.

## Technical and work plan

1. Completed: inspect badge assignment and retry behavior; implement a focused fix.
2. Completed: add regression tests for empty results and transitions through retry.
3. Completed: independently review and verify visible transitions with Computer Use.
4. Completed: commit the fix/tests and record results below.

## Validation

The retry branch previously updated only nonzero counts. Badge assignment now
happens before HTML rendering and uses the same count/error/empty state in both
the normal and retry paths.

Deterministic tests also reproduced older requests overwriting a newer empty
selection after panel readiness or retry focus completed. A panel render
revision now rejects these outdated writes without changing panel lifecycle.

Computer Use found an additional VS Code issue: assigning `undefined` updates
the API badge state but leaves the old activity badge visible. This was verified
in the installed VS Code and cached 1.108.2 workbench code: the webview view's
badge updater replaces activity only for a defined badge and does not clear it
otherwise. Empty results therefore publish an explicit zero-row badge to
replace the old visible count.

- All 581 client unit tests passed after the explicit-zero change; the final
  focused ResultsViewer run passed all 15 tests after initializing new views
  with the same zero state.
- Client type checking passes.
- Computer Use verified visible transitions from 2 rows to empty (badge hidden),
  then 3 rows, then no tables (hidden), then an error badge, then a retried empty
  result (hidden). Empty states expose `0 rows` to accessibility APIs. The
  visible table contents changed with each result.
- Both focused integration checks passed in the real VS Code extension host,
  covering populated/empty/tableless transitions and error-to-empty rendering
  recovery. Verification used synthetic local results; no cluster was needed.
