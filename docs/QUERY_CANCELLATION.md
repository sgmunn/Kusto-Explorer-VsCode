# Query cancellation

## Brief and requirements

Confirmed: users investigating data need a Cancel button to stop a long-running
query. This extends the existing run/results workflow.

Confirmed placement: Cancel beside the running query and in its progress
notification. Results reruns use a cancellable progress notification. The user
confirmed this placement during implementation. An editor toolbar shortcut is a
routine usability addition.

Routine implementation, cleanup, and testing decisions are delegated to the
project lead. Changes to query semantics or broader workflow need user input.

## Acceptance criteria

- A running query exposes an accessible Cancel action.
- Cancellation reaches the language-server request and underlying query token.
- Cancelling one query does not cancel unrelated runs.
- Cancelled runs do not replace results, add history, or show execution errors.
- Running indicators clear and a subsequent query can run normally.
- Results reruns can be cancelled without changing their backing document.

## Technical plan

Pass an optional VS Code cancellation token through the server client, using
the existing language-server cancellation protocol. Associate token sources with
individual editor runs and connect the Cancel command and progress notification.
Guard result processing after cancellation and dispose subscriptions/sources.
Review backend propagation and avoid swallowing cancellation as a query error.

Each run has its own token. A CodeLens Cancel targets the newest run of that
query range; the toolbar targets the newest run in the active document. Each
notification cancels its associated run. Cancel controls disappear once query
execution finishes, before the existing result publication workflow starts.
Cancelled runs finish promptly in the UI while the server winds down, and late
responses are ignored.

## Prioritized work plan

1. Completed: implement query cancellation and commit regression tests.
2. Completed: independently review cancellation, concurrency, and rerun preservation.
3. Completed: run automated checks and verify visible controls with Computer Use.
4. Completed: record validation and remaining limits below.

## Validation

- Server build passed without warnings or errors. All 203 server tests passed,
  including three new checks for pre-cancelled queries, commands, and typed
  requests. Cancelled requests preserve cancellation instead of producing query
  diagnostics or starting authentication.
- An additional SDK boundary test passed: an in-flight query receives the
  caller's token, exits on cancellation, and is not retried. All four server
  cancellation regression tests passed together.
- Client type checking and all 572 unit tests passed. New tests cover prompt
  cancellation, concurrent isolation, late failures, subscription cleanup, and
  request argument compatibility for callers without tokens.
- All three cancellation integration cases passed in VS Code 1.108.2. They
  verify CodeLens targeting, cancellation completing before the mock server
  responds, concurrent-run isolation, ignored late results/errors, cleared
  controls, a subsequent successful run, and preserved rerun file contents.
- The combined cancellation/editor integration run had nine passing cases and
  one timeout in the existing `runQuery with explicit range does not need
  getQueryRange` test. That test passes alone. Running the original code at
  `326addb` from a separately compiled temporary copy reproduced the same
  timeout (six passing, one failing), confirming it predates this change.
- Computer Use verified inline Cancel, notification Cancel, toolbar Cancel
  Query, and Results Rerun cancellation in an isolated extension development
  host. All four cancelled their tokens, cleared running UI, left history
  unchanged, and ignored responses deliberately delivered 2.5 seconds later.
  The saved rerun result remained `Value=42` instead of the late `Value=999`,
  both visibly and in its backing file.
- Queries in automated/UI tests use controlled server responses; stopping
  computation on a live ADX cluster has not been verified. All acceptance
  criteria are verified at the client/UI and SDK-token boundaries.
