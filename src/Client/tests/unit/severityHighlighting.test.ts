// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import {
    createSeverityHighlightingContribution,
    type SeverityLevel,
} from '../../features/workbenchGrid/severityHighlighting';

const colors: Record<SeverityLevel, string> = {
    1: '#11000011',
    2: '#22000022',
    3: '#33000033',
    4: '#44000044',
    5: '#55000055',
};

function applyContribution(
    columnName: string,
    values: unknown[],
    configuredColors: Record<SeverityLevel, string> = colors,
) {
    const contribution = createSeverityHighlightingContribution(configuredColors);
    const setProperty = vi.fn();
    const removeProperty = vi.fn();
    const container = { style: { setProperty, removeProperty } };
    const tableData = {
        columns: [{ name: 'Message' }, { name: columnName }],
        rows: values.map((value, index) => [`row ${index}`, value]),
    };
    const rows = values.map(() => [{ attributes: {} }, { attributes: {} }]);

    Function('container', 'tableData', 'rows', contribution.beforeCreateScript ?? '')(
        container,
        tableData,
        rows,
    );
    return { contribution, rows, setProperty, removeProperty };
}

describe('severity row highlighting', () => {
    it('tags levels 1 through 5 from a case-insensitive severity column', () => {
        const { rows } = applyContribution('SeVeRiTy', [1, '2', 3, 4, 5, 0, 6, 'error']);

        expect(rows.map(row => row[0].attributes['data-workbench-severity'])).toEqual([
            '1', '2', '3', '4', '5', undefined, undefined, undefined,
        ]);
    });

    it('recognizes a level column and configures every highlight color', () => {
        const { contribution, rows, setProperty } = applyContribution('level', [1]);

        expect(rows[0]![0].attributes['data-workbench-severity']).toBe('1');
        expect(setProperty).toHaveBeenCalledTimes(5);
        expect(setProperty).toHaveBeenCalledWith('--workbench-severity-1', '#11000011');
        expect(contribution.headHtml).toContain('data-workbench-severity="5"');
        expect(contribution.headHtml).toContain('td:not(:first-child)');
    });

    it('does not tag rows when no exact level or severity column exists', () => {
        const { rows } = applyContribution('SeverityText', [1]);

        expect(rows[0]![0].attributes).toEqual({});
    });

    it('removes the color override when a configured color is empty', () => {
        const { setProperty, removeProperty } = applyContribution('severity', [4], {
            ...colors,
            4: '',
        });

        expect(removeProperty).toHaveBeenCalledWith('--workbench-severity-4');
        expect(setProperty).not.toHaveBeenCalledWith('--workbench-severity-4', expect.anything());
    });
});
