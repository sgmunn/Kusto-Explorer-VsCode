// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { buildActivityTreeProjection } from '../../features/activityTree';
import type { ResultTable } from '../../features/server';

function table(rows: unknown[][]): ResultTable {
    return {
        name: 'Activities',
        columns: [
            { name: 'Event', type: 'string' },
            { name: 'CurrentActivityId', type: 'string' },
            { name: 'ParentActivityId', type: 'string' },
        ],
        rows,
    };
}

describe('buildActivityTreeProjection', () => {
    it('returns undefined when the hierarchy columns are absent', () => {
        const result = buildActivityTreeProjection({
            name: 'Other',
            columns: [{ name: 'Value', type: 'string' }],
            rows: [['x']],
        });
        expect(result).toBeUndefined();
    });

    it('groups duplicate activity ids as event rows and orders children depth first', () => {
        const result = buildActivityTreeProjection(table([
            ['root start', 'root', null],
            ['child event', 'child', 'root'],
            ['root end', 'root', null],
            ['child end', 'child', 'root'],
        ]))!;

        expect(result.rows.map(row => row.sourceRowIndex)).toEqual([0, 1, 3, 2]);
        expect(result.rows.map(row => row.depth)).toEqual([0, 1, 1, 0]);
        expect(result.rows.map(row => row.firstInActivity)).toEqual([true, true, false, false]);
        expect(result.rows.map(row => row.eventCount)).toEqual([2, 2, undefined, undefined]);
        expect(result.rows.map(row => result.activities[row.activityIndex]!.activityId)).toEqual(['root', 'child', 'child', 'root']);
        expect(result.activities).toEqual([
            { activityId: 'root', childActivityCount: 1, subtreeActivityCount: 2, maxDescendantDepth: 1 },
            { activityId: 'child', parentActivityIndex: 0, childActivityCount: 0, subtreeActivityCount: 1, maxDescendantDepth: 0 },
        ]);
    });

    it('reports branch size and deepest descendant depth', () => {
        const result = buildActivityTreeProjection(table([
            ['root', 'root', null],
            ['child', 'child', 'root'],
            ['grandchild', 'grandchild', 'child'],
            ['sibling', 'sibling', 'root'],
        ]))!;

        expect(result.activities.map(activity => ({
            id: activity.activityId,
            size: activity.subtreeActivityCount,
            depth: activity.maxDescendantDepth,
        }))).toEqual([
            { id: 'root', size: 4, depth: 2 },
            { id: 'child', size: 2, depth: 1 },
            { id: 'grandchild', size: 1, depth: 0 },
            { id: 'sibling', size: 1, depth: 0 },
        ]);
    });

    it('supports multiple roots in first-observed order', () => {
        const result = buildActivityTreeProjection(table([
            ['root b', 'root-b', null],
            ['root a', 'root-a', null],
            ['child a', 'child-a', 'root-a'],
        ]))!;

        expect(result.rows.map(row => result.activities[row.activityIndex]!.activityId)).toEqual(['root-b', 'root-a', 'child-a']);
        expect(result.rows.map(row => row.depth)).toEqual([0, 0, 1]);
    });

    it('keeps missing parents as marked roots', () => {
        const result = buildActivityTreeProjection(table([
            ['orphan', 'child', 'missing-parent'],
        ]))!;

        expect(result.activities[result.rows[0]!.activityIndex]!.activityId).toBe('child');
        expect(result.rows[0]).toMatchObject({ depth: 0, issue: 'orphan' });
    });

    it('does not guess when one activity reports conflicting parents', () => {
        const result = buildActivityTreeProjection(table([
            ['parent a', 'a', null],
            ['parent b', 'b', null],
            ['child event 1', 'child', 'a'],
            ['child event 2', 'child', 'b'],
        ]))!;

        const childRows = result.rows.filter(row => result.activities[row.activityIndex]!.activityId === 'child');
        expect(childRows).toHaveLength(2);
        expect(childRows[0]).toMatchObject({ depth: 0, issue: 'conflictingParents' });
    });

    it('breaks cycles without dropping rows', () => {
        const result = buildActivityTreeProjection(table([
            ['a', 'a', 'b'],
            ['b', 'b', 'a'],
        ]))!;

        expect(result.rows).toHaveLength(2);
        expect(new Set(result.rows.map(row => row.sourceRowIndex))).toEqual(new Set([0, 1]));
        expect(result.rows.some(row => row.issue === 'cycle')).toBe(true);
    });
});
