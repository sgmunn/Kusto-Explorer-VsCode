#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
client_dir="$repo_root/src/Client"

for command in node npm npx dotnet; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command not found: $command" >&2
        exit 1
    fi
done

package_version="$(node -p "require('$client_dir/package.json').version")"
output_path="${1:-$client_dir/kustotracetools-$package_version.vsix}"
if [[ "$output_path" != /* ]]; then
    output_path="$PWD/$output_path"
fi

mkdir -p "$(dirname "$output_path")"

cd "$client_dir"
npm run prepackage
npx --yes @vscode/vsce package --out "$output_path"

echo "Built VSIX: $output_path"