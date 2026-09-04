// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import {
    createColumnFilterContribution,
    matchesColumnFilter,
    operatorsForKustoType,
} from '../../features/workbenchGrid/columnFilters';
import type { ColumnFilter } from '../../features/workbenchGrid/columnFilters';

function filter(
    type: string,
    conditions: ColumnFilter['conditions'],
    join: ColumnFilter['join'] = 'and',
): ColumnFilter {
    return { columnIndex: 0, type, join, conditions };
}

describe('workbench column filters', () => {
    it('offers operators appropriate to the Kusto column type', () => {
        expect(operatorsForKustoType('string').map(option => option.value)).toContain('contains');
        expect(operatorsForKustoType('long').map(option => option.value)).toContain('greaterThan');
        expect(operatorsForKustoType('datetime').find(option => option.value === 'greaterThan')?.label)
            .toBe('After');
        expect(operatorsForKustoType('bool').map(option => option.value)).toEqual([
            'isTrue', 'isFalse', 'isEmpty', 'isNotEmpty',
        ]);
    });

    it('matches string operators without case sensitivity', () => {
        expect(matchesColumnFilter('Alpha Beta', filter('string', [
            { operator: 'contains', value: 'BETA' },
        ]))).toBe(true);
        expect(matchesColumnFilter('Alpha Beta', filter('string', [
            { operator: 'startsWith', value: 'alpha' },
        ]))).toBe(true);
        expect(matchesColumnFilter('Alpha Beta', filter('string', [
            { operator: 'notContains', value: 'beta' },
        ]))).toBe(false);
    });

    it('combines two conditions with AND or OR', () => {
        const conditions: ColumnFilter['conditions'] = [
            { operator: 'startsWith', value: 'alpha' },
            { operator: 'contains', value: 'gamma' },
        ];
        expect(matchesColumnFilter('Alpha Beta', filter('string', conditions, 'and'))).toBe(false);
        expect(matchesColumnFilter('Alpha Beta', filter('string', conditions, 'or'))).toBe(true);
    });

    it('uses typed comparisons for numbers, datetimes, and timespans', () => {
        expect(matchesColumnFilter('20', filter('long', [
            { operator: 'greaterThan', value: '3' },
        ]))).toBe(true);
        expect(matchesColumnFilter('2026-09-04T12:00:00Z', filter('datetime', [
            { operator: 'lessThan', value: '2026-09-05T00:00:00Z' },
        ]))).toBe(true);
        expect(matchesColumnFilter('1.00:00:00', filter('timespan', [
            { operator: 'greaterThan', value: '12:00:00' },
        ]))).toBe(true);
        expect(matchesColumnFilter('not a number', filter('long', [
            { operator: 'greaterThan', value: '3' },
        ]))).toBe(false);
    });

    it('handles booleans, empty values, and Simple-DataTables cell objects', () => {
        expect(matchesColumnFilter({ text: 'true' }, filter('bool', [
            { operator: 'isTrue' },
        ]))).toBe(true);
        expect(matchesColumnFilter(null, filter('string', [
            { operator: 'isEmpty' },
        ]))).toBe(true);
        expect(matchesColumnFilter('value', filter('string', [
            { operator: 'isNotEmpty' },
        ]))).toBe(true);
    });

    it('builds a self-contained webview contribution around multiSearch', () => {
        const contribution = createColumnFilterContribution();

        expect(contribution.headHtml).toContain('.workbench-filter-popover');
        expect(contribution.headHtml).toContain('.workbench-clear-filters');
        expect(contribution.beforeCreateScript).toContain('setting.searchMethod');
        expect(contribution.afterCreateScript).toContain('grid.multiSearch(queries)');
        expect(contribution.afterCreateScript).toContain('filter.columnIndex + 1');
        expect(contribution.afterCreateScript).toContain('Clear all filters');
        expect(() => Function(contribution.beforeCreateScript ?? '')).not.toThrow();
        expect(() => Function(contribution.afterCreateScript ?? '')).not.toThrow();
    });

    it('uses a normalization-safe token instead of a serialized query payload', () => {
        type SearchMethod = (
            terms: string[],
            cell: unknown,
            row: unknown,
            columnIndex: number,
            source: string,
        ) => boolean;
        const contribution = createColumnFilterContribution();
        const columnSettings: Array<{ searchMethod?: SearchMethod }> = [{}, {}];
        const install = Function(
            'columnSettings',
            `${contribution.beforeCreateScript ?? ''}
             return { filters: workbenchColumnFilters, term: workbenchFilterTerm };`,
        ) as (settings: Array<{ searchMethod?: SearchMethod }>) => {
            filters: Record<number, ColumnFilter>;
            term: string;
        };
        const runtime = install(columnSettings);
        const search = columnSettings[1]!.searchMethod!;
        runtime.filters[0] = filter('string', [{ operator: 'contains', value: 'beta' }]);

        expect(runtime.term).toMatch(/^[a-z0-9]+$/);
        expect(search([runtime.term], { text: 'Alpha Beta' }, {}, 1, 'search')).toBe(true);
        expect(search([runtime.term], { text: 'Alpha' }, {}, 1, 'search')).toBe(false);
        expect(search(['BETA'], { text: 'Alpha Beta' }, {}, 1, 'search')).toBe(true);
    });
});
