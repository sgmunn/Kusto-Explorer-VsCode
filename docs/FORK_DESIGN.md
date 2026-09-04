# Kusto Explorer Results Workbench

This fork focuses on making Kusto query results practical for investigating
large, structured diagnostic traces. The primary workflow is: run a query,
select one or more result rows, and inspect the useful details without leaving
the editor.

## Results inspector

The results view has a row-details inspector in the right-hand panel. It is
bound to the selected result row and presents structured content in a readable
form.

The inspector should:

- Support a quick find/search experience, including highlighted matches.
- Offer word wrap on and off, so both prose and long, structured lines remain
  usable.
- Render JSON cleanly when a value contains JSON.
- Make long values readable rather than duplicating the cramped table layout.

## Multipart diagnostic messages

Some exception details are emitted as several events, prefixed with a sequence
marker such as `1/2:`. When the user selects every part of one complete
message, the inspector should assemble the parts in sequence and remove the
prefixes before rendering.

Assembly is deliberately conservative: unrelated rows, incomplete sequences,
or ordinary messages should remain separate. A successfully assembled payload
will commonly be JSON and should receive the normal JSON presentation.

## Exception and call-stack presentation

Exception objects often contain a `callStack` value that is technically useful
but difficult to scan. The client-side formatter should improve readability
without requiring query-side KQL transformations.

Desired behavior:

- Normalize literal and actual line breaks so there is at least one displayed
  line per stack frame, even when telemetry placed several frames on one line.
- Preserve application frames and remove well-known runtime noise, including
  `System.Threading`, `System.Runtime`, `System.Net`, `System.IO`,
  `System.Text.Json`, `System.Diagnostics`, `System.Collections`, and `Polly`
  frames.
- Never hide an entire stack merely because a line initially contained both an
  application frame and runtime frames; frames must be split before filtering.
- Remove compiler-generated implementation detail where it obscures the useful
  method name.
- Reduce source paths such as
  `D:\\a\\_work\\1\\s\\Core\\Example.cs :line 114` to the filename and line
  information, e.g. `Example.cs:line 114`.
- Join artificial line breaks around the source location so a frame reads
  naturally as `... Example.cs:line 114 at ...`.

The original KQL cleanup expression was a useful reference, but the extension
owns this display transformation so raw query results stay intact.

## Query parameter profiles

Queries frequently reuse a small set of context values such as a root activity
ID (`raid`) or environment. The extension should pass these values as native
Kusto query parameters, rather than textually prepending `let` statements or
substituting strings into query text.

Queries declare the values they need:

```kql
declare query_parameters(raid:string);
ASEdog().ASTrace
| where RootActivityId == raid
```

Profiles are stored in a workspace-editable `.kusto/parameters.yaml` file so
they can be reviewed, edited comfortably, and optionally shared with the
workspace:

```yaml
active: Incident A
profiles:
  Incident A:
    raid: abc-123
    environment: prod
  Incident B:
    raid: def-456
    environment: prod
```

The status-bar profile picker remains useful for switching active contexts
quickly. Changes made through it should update the YAML file, while changes
saved directly in YAML should take effect without restarting the extension.

## Agent access to query results

The VS Code agent should be able to receive existing query results as context,
so the user can ask questions about data that has already been retrieved and
processed without copying it manually or running the query again.

The handoff should make the scope clear and intentional. It should support
sharing the selected result rows first, with an option to share the current
result set when that is appropriate. The agent receives the displayed schema,
values, and any client-side processing relevant to interpretation, such as a
reassembled multipart exception payload.

The user experience should make three facts visible before sharing:

- Which rows or result set will be sent to the agent.
- How much data is included, with sensible limits for large result sets.
- Whether the data is raw table data, formatted row details, or both.

This is context transfer, not an implicit database connection or permission to
rerun the query. The agent can then summarize, explain, search for patterns,
or suggest follow-up KQL based on the provided results. Any new query execution
continues to use the extension's normal connection and user-initiated run flow.

## Replaceable results grid

The grid is expected to evolve substantially in this fork, but that work should
not spread through the upstream results lifecycle. Live query results, history
items, and `.kqr` documents should all continue to use `ResultsViewer` for
their tabs, charts, query text, persistence, and command routing.

The replacement boundary is `IDataTableProvider`. Every results surface already
asks this provider to create its table views, so the extension composition root
can supply a fork-owned implementation without teaching each caller about the
new grid.

```text
ResultData or .kqr
        |
  ResultsViewer                 upstream orchestration
        |
 IDataTableProvider             compatibility boundary
        |
 WorkbenchDataTableProvider     fork-owned implementation
```

The fork-owned provider must preserve the small host contract relied upon by
the rest of the extension:

- Create a grid from a `ResultTable` and optional saved `ResultTableView`.
- Report selected source-row indexes for the Row Details inspector.
- Support the existing copy, search, and drag/export commands.
- Report column order and widths so presentation state can persist in `.kqr`.
- Release webview handlers when a result view is replaced or closed.

Migration should be incremental. The first step redirects construction to
`WorkbenchDataTableProvider`, which delegates to the current provider while the
new implementation is developed behind that boundary. Subsequent work replaces
the delegate from inside the fork-owned module. This leaves the lasting
upstream-facing change as a provider import and construction change in the
extension entry point, while grid code and tests remain isolated in their own
folder.

The new grid should begin with behavioral parity: virtualized rows, sorting,
search, selection, column resize/reorder, copy formats, Row Details events, and
saved view state. New capabilities can then be added without changing
`ResultsViewer` or introducing a separate `.kqr` rendering path.

### Column filters

The workbench grid adds an ADX-style funnel action to each data-column header.
Filters are type aware: strings use text operators, numeric and timespan values
use comparisons, datetimes use temporal comparisons, and booleans use true or
false predicates. A column can have up to two conditions combined with AND or
OR. Active funnels are highlighted, and the grid toolbar exposes a single
**Clear all filters** action.

Column filters combine with the existing global search and are evaluated over
the complete result table already loaded into the webview, before pagination.
They therefore do not fetch additional rows, rerun the query, or alter the KQL.
Filter state is intentionally transient: it lasts for the open grid view but is
not currently persisted in `.kqr` files. The implementation lives in
`features/workbenchGrid`; the legacy grid exposes only a small optional webview
contribution hook so upstream grid changes remain straightforward to merge.

## Guiding principles

- Keep query source and returned data faithful; formatting is a client display
  concern.
- Prefer conservative transformations that preserve diagnostic evidence.
- Keep common investigation actions close to results instead of requiring KQL
  rewrites or copying data into another tool.
- Make the useful path easy for large exception payloads, while allowing users
  to opt out of presentation choices such as word wrapping.
- Keep fork-specific grid rendering behind a narrow provider contract so
  upstream changes remain straightforward to merge.
