// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Formatting helpers for exposing saved History results to language-model
 * tools without rerunning the original query.
 */

import type { ResultData, ResultTable } from './server';
import { resultTableToMarkdown } from './markdown';

export const DEFAULT_SAVED_RESULT_MAX_ROWS = 100;
export const MAX_SAVED_RESULT_ROWS = 1000;

export interface SavedQueryResultOptions {
    tableName?: string;
    maxRows?: number;
}

function normalizeMaxRows(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_SAVED_RESULT_MAX_ROWS;
    }
    return Math.max(1, Math.min(MAX_SAVED_RESULT_ROWS, Math.floor(value)));
}

function displayTableName(name: string): string {
    return name || '(unnamed)';
}

function formatTable(table: ResultTable, maxRows: number): string {
    const visibleRows = table.rows.slice(0, maxRows);
    const markdown = resultTableToMarkdown({ ...table, rows: visibleRows });
    const heading = `## Table: ${displayTableName(table.name)} (${table.rows.length} rows)`;
    const truncation = table.rows.length > visibleRows.length
        ? `\n\n_Showing the first ${visibleRows.length} of ${table.rows.length} rows._`
        : '';
    return `${heading}\n\n${markdown || '(No columns)'}${truncation}`;
}

/** Formats one saved execution, including every table unless one is selected. */
export function formatSavedQueryResults(
    data: ResultData,
    clientRequestId: string,
    options: SavedQueryResultOptions = {}
): string {
    const maxRows = normalizeMaxRows(options.maxRows);
    let tables = data.tables ?? [];

    if (options.tableName !== undefined) {
        tables = tables.filter(table => table.name === options.tableName);
        if (tables.length === 0) {
            const available = data.tables.length > 0
                ? data.tables.map(table => displayTableName(table.name)).join(', ')
                : '(none)';
            return `No table named "${options.tableName}" was found for CID ${clientRequestId}. Available tables: ${available}.`;
        }
    }

    const metadata = [
        'Saved Kusto query results',
        `CID: ${clientRequestId}`,
        data.cluster ? `Cluster: ${data.cluster}` : undefined,
        data.database ? `Database: ${data.database}` : undefined,
        data.executionStartedAt ? `Started: ${data.executionStartedAt}` : undefined,
        `Tables: ${data.tables.length > 0 ? data.tables.map(table => displayTableName(table.name)).join(', ') : '(none)'}`,
    ].filter((line): line is string => line !== undefined);

    if (tables.length === 0) {
        return `${metadata.join('\n')}\n\nThis saved execution contains no result tables.`;
    }

    return `${metadata.join('\n')}\n\n${tables.map(table => formatTable(table, maxRows)).join('\n\n')}`;
}
