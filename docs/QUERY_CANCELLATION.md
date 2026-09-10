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

## Prioritized work plan

1. Implement query cancellation and regression tests; commit a cohesive change.
2. Independently review cancellation, concurrent runs, and rerun preservation.
3. Run automated checks and use Computer Use to verify visible controls.
4. Record validation and any remaining limits here.

## Validation

- Server build passed without warnings or errors. All 203 server tests passed,
  including three new checks for pre-cancelled queries, commands, and typed
  requests. Cancelled requests preserve cancellation instead of producing query
  diagnostics or starting authentication.
- Client implementation and independent integration/UI verification in progress.
