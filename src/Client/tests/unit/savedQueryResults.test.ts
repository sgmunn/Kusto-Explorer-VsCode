// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { ResultData } from '../../features/server';
import { formatSavedQueryResults } from '../../features/savedQueryResults';

function makeResultData(): ResultData {
    return {
        query: 'print value=1',
        cluster: 'help.kusto.windows.net',
        database: 'Samples',
        executionStartedAt: '2026-09-08T12:00:00.000Z',
        clientRequestId: 'KustoTraceTools;test-cid',
        tables: [
            {
                name: 'PrimaryResult',
                columns: [{ name: 'Value', type: 'long' }],
                rows: [[1], [2], [3]],
            },
            {
                name: 'SecondaryResult',
                columns: [{ name: 'Message', type: 'string' }],
                rows: [['done']],
            },
        ],
    };
}

describe('formatSavedQueryResults', () => {
    it('returns every result table with execution metadata', () => {
        const output = formatSavedQueryResults(makeResultData(), 'KustoTraceTools;test-cid');

        expect(output).toContain('CID: KustoTraceTools;test-cid');
        expect(output).toContain('Cluster: help.kusto.windows.net');
        expect(output).toContain('## Table: PrimaryResult (3 rows)');
        expect(output).toContain('## Table: SecondaryResult (1 rows)');
        expect(output).toContain('| Value |');
        expect(output).toContain('| Message |');
    });

    it('selects one table by exact name', () => {
        const output = formatSavedQueryResults(makeResultData(), 'KustoTraceTools;test-cid', {
            tableName: 'SecondaryResult',
        });

        expect(output).not.toContain('## Table: PrimaryResult');
        expect(output).toContain('## Table: SecondaryResult');
    });

    it('reports available tables when an exact table name is missing', () => {
        const output = formatSavedQueryResults(makeResultData(), 'KustoTraceTools;test-cid', {
            tableName: 'Missing',
        });

        expect(output).toContain('No table named "Missing"');
        expect(output).toContain('Available tables: PrimaryResult, SecondaryResult');
    });

    it('limits rows per table and reports truncation', () => {
        const output = formatSavedQueryResults(makeResultData(), 'KustoTraceTools;test-cid', {
            tableName: 'PrimaryResult',
            maxRows: 2,
        });

        expect(output).toContain('| 1 |');
        expect(output).toContain('| 2 |');
        expect(output).not.toContain('| 3 |');
        expect(output).toContain('Showing the first 2 of 3 rows');
    });
});
