// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Immutable;

namespace Kusto.Vscode;

public static class ChartSettings
{
    public static readonly Setting<string?> LegendPosition =
        new Setting<string?>("kustoTraceTools.chart.legendPosition", null);

    public static readonly Setting<string?> XShowTicks =
        new Setting<string?>("kustoTraceTools.chart.xShowTicks", null);

    public static readonly Setting<string?> YShowTicks =
        new Setting<string?>("kustoTraceTools.chart.yShowTicks", null);

    public static readonly Setting<string?> XShowGrid =
        new Setting<string?>("kustoTraceTools.chart.xShowGrid", null);

    public static readonly Setting<string?> YShowGrid =
        new Setting<string?>("kustoTraceTools.chart.yShowGrid", null);

    public static readonly Setting<string?> ShowValues =
        new Setting<string?>("kustoTraceTools.chart.showValues", null);

    public static readonly Setting<string?> TextSize =
        new Setting<string?>("kustoTraceTools.chart.textSize", null);

    public static readonly Setting<string?> AspectRatio =
        new Setting<string?>("kustoTraceTools.chart.aspectRatio", null);

    public static readonly ImmutableList<Setting> All =
        [
            LegendPosition,
            XShowTicks,
            YShowTicks,
            XShowGrid,
            YShowGrid,
            ShowValues,
            TextSize,
            AspectRatio
        ];
}
