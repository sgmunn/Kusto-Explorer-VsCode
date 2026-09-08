// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ResultTable } from './server';

export type ActivityTreeIssue = 'orphan' | 'conflictingParents' | 'cycle';

export interface ActivityTreeRow {
    sourceRowIndex: number;
    depth: number;
    firstInActivity: boolean;
    eventCount?: number;
    activityIndex: number;
    issue?: ActivityTreeIssue;
}

export interface ActivityTreeActivity {
    activityId: string;
    parentActivityIndex?: number;
    childActivityCount: number;
    /** Number of activities in this branch, including this activity. */
    subtreeActivityCount: number;
    /** Longest child chain below this activity; leaves have depth zero. */
    maxDescendantDepth: number;
}

export interface ActivityTreeProjection {
    currentActivityColumnIndex: number;
    parentActivityColumnIndex: number;
    activities: ActivityTreeActivity[];
    rows: ActivityTreeRow[];
}

interface ActivityGroup {
    index: number;
    key: string;
    activityId: string;
    rowIndexes: number[];
    parentCandidates: Set<string>;
    parentKey?: string;
    children: ActivityGroup[];
    firstRowIndex: number;
    issue?: ActivityTreeIssue;
}

function columnIndex(table: ResultTable, name: string): number {
    const exact = table.columns.findIndex(column => column.name === name);
    if (exact >= 0) return exact;
    const folded = name.toLocaleLowerCase();
    return table.columns.findIndex(column => column.name.toLocaleLowerCase() === folded);
}

function idFromCell(value: unknown | null): string | undefined {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function compareGroups(a: ActivityGroup, b: ActivityGroup): number {
    return a.firstRowIndex - b.firstRowIndex;
}

/**
 * Projects event rows into a depth-first forest of activity groups. Rows with
 * the same CurrentActivityId remain individual events within one activity.
 */
export function buildActivityTreeProjection(table: ResultTable): ActivityTreeProjection | undefined {
    const currentActivityColumnIndex = columnIndex(table, 'CurrentActivityId');
    const parentActivityColumnIndex = columnIndex(table, 'ParentActivityId');
    if (currentActivityColumnIndex < 0 || parentActivityColumnIndex < 0) return undefined;

    const groupsByKey = new Map<string, ActivityGroup>();
    const orderedGroups: ActivityGroup[] = [];

    table.rows.forEach((row, sourceRowIndex) => {
        const activityId = idFromCell(row[currentActivityColumnIndex]);
        // Rows without an activity id cannot be correlated safely. Keep each
        // one as an independent root so no source data disappears.
        const key = activityId ?? `\u0000missing:${sourceRowIndex}`;
        let group = groupsByKey.get(key);
        if (!group) {
            group = {
                index: orderedGroups.length,
                key,
                activityId: activityId ?? '(missing CurrentActivityId)',
                rowIndexes: [],
                parentCandidates: new Set<string>(),
                children: [],
                firstRowIndex: sourceRowIndex,
            };
            groupsByKey.set(key, group);
            orderedGroups.push(group);
        }
        group.rowIndexes.push(sourceRowIndex);

        const parentId = idFromCell(row[parentActivityColumnIndex]);
        if (activityId && parentId) group.parentCandidates.add(parentId);
    });

    for (const group of orderedGroups) {
        const candidates = [...group.parentCandidates];
        if (candidates.length > 1) {
            group.issue = 'conflictingParents';
            continue;
        }
        if (candidates.length === 1) {
            const parentKey = candidates[0]!;
            if (!groupsByKey.has(parentKey)) {
                group.issue = 'orphan';
            } else {
                group.parentKey = parentKey;
            }
        }
    }

    // Break each parent cycle at its earliest-observed activity. The affected
    // group becomes a root; all event rows remain visible.
    const sortedGroups = [...orderedGroups].sort(compareGroups);
    for (const start of sortedGroups) {
        const path: ActivityGroup[] = [];
        const pathIndexes = new Map<string, number>();
        let current: ActivityGroup | undefined = start;
        while (current?.parentKey) {
            const cycleStart = pathIndexes.get(current.key);
            if (cycleStart !== undefined) {
                const cycle = path.slice(cycleStart);
                const breakAt = [...cycle].sort(compareGroups)[0]!;
                delete breakAt.parentKey;
                breakAt.issue = 'cycle';
                break;
            }
            pathIndexes.set(current.key, path.length);
            path.push(current);
            current = groupsByKey.get(current.parentKey);
        }
    }

    for (const group of orderedGroups) {
        if (!group.parentKey) continue;
        groupsByKey.get(group.parentKey)?.children.push(group);
    }
    for (const group of orderedGroups) group.children.sort(compareGroups);

    const roots = orderedGroups.filter(group => !group.parentKey).sort(compareGroups);
    const branchStats = new Map<string, { subtreeActivityCount: number; maxDescendantDepth: number }>();
    const getBranchStats = (group: ActivityGroup): { subtreeActivityCount: number; maxDescendantDepth: number } => {
        const cached = branchStats.get(group.key);
        if (cached) return cached;
        const childStats = group.children.map(getBranchStats);
        const stats = {
            subtreeActivityCount: 1 + childStats.reduce((sum, child) => sum + child.subtreeActivityCount, 0),
            maxDescendantDepth: childStats.length
                ? 1 + Math.max(...childStats.map(child => child.maxDescendantDepth))
                : 0,
        };
        branchStats.set(group.key, stats);
        return stats;
    };
    const activities: ActivityTreeActivity[] = orderedGroups.map(group => ({
        activityId: group.activityId,
        ...(group.parentKey !== undefined && {
            parentActivityIndex: groupsByKey.get(group.parentKey)!.index,
        }),
        childActivityCount: group.children.length,
        ...getBranchStats(group),
    }));
    const rows: ActivityTreeRow[] = [];
    const appendRow = (
        group: ActivityGroup,
        sourceRowIndex: number,
        eventIndex: number,
        depth: number
    ): void => {
        rows.push({
            sourceRowIndex,
            depth,
            firstInActivity: eventIndex === 0,
            activityIndex: group.index,
            ...(eventIndex === 0 && { eventCount: group.rowIndexes.length }),
            ...(eventIndex === 0 && group.issue && { issue: group.issue }),
        });
    };
    const appendGroup = (group: ActivityGroup, depth: number): void => {
        // The first event doubles as the activity node. Put child activities
        // immediately below it, then the activity's remaining event rows.
        // This keeps a high-volume parent from burying its children beneath
        // hundreds of repeated CurrentActivityId values.
        appendRow(group, group.rowIndexes[0]!, 0, depth);
        group.children.forEach(child => appendGroup(child, depth + 1));
        group.rowIndexes.slice(1).forEach((sourceRowIndex, index) => {
            appendRow(group, sourceRowIndex, index + 1, depth);
        });
    };
    roots.forEach(root => appendGroup(root, 0));

    return { currentActivityColumnIndex, parentActivityColumnIndex, activities, rows };
}
