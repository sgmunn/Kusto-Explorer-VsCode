// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import type { IDataTableWebviewContribution } from '../dataTableProvider';

export type SeverityLevel = 1 | 2 | 3 | 4 | 5;

export const defaultSeverityColors: Record<SeverityLevel, string> = {
    1: '#f14c4c40',
    2: '#f4877133',
    3: '#cca7002e',
    4: '#89d1851f',
    5: '#75beff17',
};

const settingNames: Record<SeverityLevel, string> = {
    1: 'critical',
    2: 'error',
    3: 'warning',
    4: 'normal',
    5: 'verbose',
};

export function getSeverityColors(): Record<SeverityLevel, string> {
    const config = vscode.workspace.getConfiguration('kustoTraceTools.results.severityColors');
    return Object.fromEntries(([1, 2, 3, 4, 5] as SeverityLevel[]).map(level => [
        level,
        config.get<string>(settingNames[level], defaultSeverityColors[level]),
    ])) as Record<SeverityLevel, string>;
}

const headHtml = `<style>
    .datatable-table tbody tr:has(td[data-workbench-severity="1"]) td:not(:first-child) { background-color: var(--workbench-severity-1); }
    .datatable-table tbody tr:has(td[data-workbench-severity="2"]) td:not(:first-child) { background-color: var(--workbench-severity-2); }
    .datatable-table tbody tr:has(td[data-workbench-severity="3"]) td:not(:first-child) { background-color: var(--workbench-severity-3); }
    .datatable-table tbody tr:has(td[data-workbench-severity="4"]) td:not(:first-child) { background-color: var(--workbench-severity-4); }
    .datatable-table tbody tr:has(td[data-workbench-severity="5"]) td:not(:first-child) { background-color: var(--workbench-severity-5); }
</style>`;

/** Highlights rows using a numeric `level` or `severity` column. */
export function createSeverityHighlightingContribution(
    colors: Record<SeverityLevel, string> = getSeverityColors(),
): IDataTableWebviewContribution {
    const colorsJson = JSON.stringify(colors).replace(/</g, '\\u003c');
    return {
        headHtml,
        beforeCreateScript: `
    var workbenchSeverityColors = ${colorsJson};
    Object.keys(workbenchSeverityColors).forEach(function(level) {
        var property = '--workbench-severity-' + level;
        var color = String(workbenchSeverityColors[level] || '').trim();
        if (color) container.style.setProperty(property, color);
        else container.style.removeProperty(property);
    });
    var workbenchSeverityColumn = tableData.columns.findIndex(function(column) {
        var name = String(column.name || '').trim().toLocaleLowerCase();
        return name === 'level' || name === 'severity';
    });
    if (workbenchSeverityColumn >= 0) {
        rows.forEach(function(row, rowIndex) {
            var level = Number(String(tableData.rows[rowIndex][workbenchSeverityColumn]).trim());
            if (!Number.isInteger(level) || level < 1 || level > 5) return;
            var cells = Array.isArray(row) ? row : row.cells;
            if (cells && cells[0] && cells[0].attributes) {
                cells[0].attributes['data-workbench-severity'] = String(level);
            }
        });
    }`,
    };
}
