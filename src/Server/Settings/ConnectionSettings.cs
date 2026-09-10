// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Immutable;

namespace Kusto.Vscode;

public class ConnectionSettings
{
    public static Setting<string> DefaultDomain =
        new Setting<string>("kustoTraceTools.defaultDomain", ".kusto.windows.net");

    public static readonly ImmutableList<Setting> All =
        [
            DefaultDomain
        ];
}