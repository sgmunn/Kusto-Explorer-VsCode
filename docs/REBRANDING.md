# KustoTraceTools local release

## Project brief and confirmed requirements

Rebrand this diagnostic-query extension to **KustoTraceTools** and deliver a
VSIX that the user can install locally. The user explicitly chose a separate
extension rather than replacing their existing Kusto Explorer installation.
Existing query editing, connections, results, charts, history, and trace
inspection remain the essential workflows.

## Decisions and assumptions

- Confirmed: visible product name is KustoTraceTools; installation is separate.
- Implementation decision: use `local.kustotracetools` as the extension ID.
  `local` is a local packaging namespace, not a registered Marketplace identity.
- Isolate commands, settings, views, tools, and extension-owned URI schemes
  under `kustoTraceTools`. Separate extension storage starts with fresh history
  and connections; do not migrate or modify the original extension's data.
- Confirmed: keep `.kql` query files and use `.ktt` for new saved results.
  Continue opening existing `.kqr` results. The user plans to uninstall the
  original extension, avoiding overlapping language providers and shortcuts.
- Preserve upstream attribution and references to the separate desktop Kusto
  Explorer application as an import source.
- Assumption: this release targets local use on the current Mac. The existing
  .NET 10 runtime requirement remains.
- Routine branding, packaging, and verification decisions are delegated to
  the project lead. Publishing, a registered publisher identity, data migration,
  and changed product workflows would require further user direction.

## Acceptance criteria

1. Extension details and extension-owned UI identify KustoTraceTools.
2. The VSIX has a distinct identity and consistent internal registrations.
3. Client and server compile; relevant automated checks pass.
4. The package includes compiled client/server, required assets, and license,
   while excluding development files and prior packages.
5. Install the package in an isolated VS Code profile and verify visible
   branding, `.kql` editing, and `.ktt` results through computer use. Cover
   backward-compatible `.kqr` opening and `.ktt` history/export in tests.
6. Deliver the VSIX path, installation instructions, validation results, and
   any unverified behavior. Commit source/documentation changes coherently.

## Technical and prioritized work plan

1. Update manifest, runtime branding, namespaces, and local-install docs.
2. Add regression coverage for the isolated identity and contributions.
3. Build the client and .NET server; inspect package contents.
4. Install and smoke-test the actual VSIX in an isolated profile.
5. Review commits and record final verification below.

## Verification

Pending implementation, package build, and smoke testing.
