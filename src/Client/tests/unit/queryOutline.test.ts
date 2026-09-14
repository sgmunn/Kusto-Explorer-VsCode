// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { createQueryOutlineEntries } from '../../features/queryOutline';

describe('query outline', () => {
    it('creates one ordered group per non-empty detected query', () => {
        const text = `// Texas storms
StormEvents
| where State == "Texas"


// ===== Recent events =====
let recent = StormEvents
    | where StartTime > ago(1d);
recent | count
`;

        expect(createQueryOutlineEntries(text, [
            { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
            { start: { line: 3, character: 0 }, end: { line: 4, character: 0 } },
            { start: { line: 5, character: 0 }, end: { line: 8, character: 14 } },
        ])).toEqual([
            {
                name: 'Texas storms',
                detail: '// Texas storms StormEvents | where State == "Texas"',
                range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
            },
            {
                name: 'Recent events',
                detail: '// ===== Recent events ===== let recent = StormEvents | where StartTime > ago...',
                range: { start: { line: 5, character: 0 }, end: { line: 8, character: 14 } },
            },
        ]);
    });

    it('truncates long query previews', () => {
        const text = `StormEvents | where Message contains "${'x'.repeat(100)}"`;
        const [entry] = createQueryOutlineEntries(text, [
            { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } },
        ]);

        expect(entry?.detail.length).toBeLessThanOrEqual(80);
        expect(entry?.detail.endsWith('...')).toBe(true);
    });
});
