// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Range } from './server';
import { computeHistoryDisplayLabel } from './historyManager';

const MAX_QUERY_PREVIEW_LENGTH = 80;

export interface QueryOutlineEntry {
    name: string;
    detail: string;
    range: Range;
}

function getLineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') starts.push(index + 1);
    }
    return starts;
}

function getOffset(text: string, lineStarts: readonly number[], line: number, character: number): number {
    if (line >= lineStarts.length) return text.length;
    const lineStart = lineStarts[Math.max(0, line)] ?? 0;
    const nextLineStart = lineStarts[line + 1] ?? text.length;
    return Math.min(lineStart + Math.max(0, character), nextLineStart);
}

function getQueryPreview(queryText: string): string {
    const preview = queryText.replace(/\s+/g, ' ').trim();
    return preview.length <= MAX_QUERY_PREVIEW_LENGTH
        ? preview
        : `${preview.slice(0, MAX_QUERY_PREVIEW_LENGTH - 3)}...`;
}

/** Converts parser-detected query ranges into ordered outline entries. */
export function createQueryOutlineEntries(text: string, ranges: readonly Range[]): QueryOutlineEntry[] {
    const lineStarts = getLineStarts(text);
    const entries = ranges.flatMap(range => {
        const start = getOffset(text, lineStarts, range.start.line, range.start.character);
        const end = getOffset(text, lineStarts, range.end.line, range.end.character);
        const queryText = text.slice(start, end);
        const detail = getQueryPreview(queryText);
        return detail ? [{ name: computeHistoryDisplayLabel(queryText), detail, range }] : [];
    });

    return entries;
}
