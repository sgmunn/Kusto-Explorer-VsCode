// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** A compact inspector for the row currently selected in a results grid. */

import * as vscode from 'vscode';
import type { ResultTable } from './server';
import type { ResultRowSelection } from './dataTableProvider';
import { escapeHtml } from './html';

export const rowDetailsViewId = 'msKustoExplorer_rowDetails';

const callstackNoise = [
    /System\.Threading\.Tasks\./,
    /System\.Threading\._IOCompletionCallback\./,
    /System\.Threading\.ExecutionContext/,
    /System\.Threading\.ThreadPool/,
    /System\.Runtime\.CompilerServices\./,
    /System\.Runtime\./,
    /System\.Net\./,
    /System\.IO\./,
    /System\.Text\.Json\./,
    /System\.Diagnostics\./,
    /System\.Collections\./,
    /Polly\./,
];

/** Formats an exception stack as useful application frames, one per line. */
export function formatExceptionCallstack(callstack: string): string {
    const normalized = callstack
        // Some telemetry payloads contain JSON's escaped newline characters
        // rather than actual newlines. Both forms are only presentation data.
        .replace(/\\[rn]/g, ' ')
        .replace(/\r\n?/g, '\n')
        // Keep only the filename in source locations. Build-agent paths add
        // width without helping diagnose the application frame.
        .replace(/(?:[A-Za-z]:\\|\\\\)[^:\r\n]*\\([^\\/:]+\.[A-Za-z0-9]+)\s*:\s*line\s*(\d+)/g, '$1:line $2')
        .replace(/\n+/g, ' ');
    // Extract every frame before formatting it for display. In particular,
    // do not join `:line N at System...` yet: doing so makes the framework
    // frame contaminate an application frame during filtering.
    const allFrames = normalized
        .split(/(?=\bat\s+[\w<])/g)
        .map(frame => frame.trim())
        .filter(frame => frame.length > 0)
        .map(frame => frame
            // Convert async state-machine frames back to their source method.
            .replace(/\.\<([^>]+)\>d__\d+\.MoveNext\(\)/g, '.$1()')
            // Do the same for compiler-generated lambda/display-class frames.
            .replace(/[.+]<>c(?:__DisplayClass\d+(?:_\d+)?)?\.\<([^>]+)\>b__\d+(?:_\d+)?\([^)]*\)/g, '.$1()'));
    // Framework filtering is optional presentation cleanup. Never allow it
    // to erase an inner exception just because its only frames are callbacks
    // or framework bridges.
    const visibleFrames = allFrames.filter(frame => !callstackNoise.some(pattern => pattern.test(frame)));
    return joinFramesForDisplay(visibleFrames.length > 0 ? visibleFrames : allFrames);
}

/** Keeps adjacent surviving source frames compact without affecting filtering. */
function joinFramesForDisplay(frames: string[]): string {
    const lines: string[] = [];
    for (const frame of frames) {
        const previous = lines.at(-1);
        if (previous && /:line\s+\d+$/i.test(previous)) {
            lines[lines.length - 1] = `${previous} ${frame}`;
        } else {
            lines.push(frame);
        }
    }
    return lines.join('\n');
}

/** Recursively applies the exception callstack display transform to JSON data. */
export function formatExceptionJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(formatExceptionJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        key.toLowerCase() === 'callstack' && typeof child === 'string'
            ? formatExceptionCallstack(child)
            : formatExceptionJson(child),
    ]));
}

/** JSON-like display text with callstack line breaks visible to the user. */
export function formatExceptionJsonForDisplay(value: unknown): string {
    // This is intentionally display-only: raw query values stay valid JSON.
    // Rendering embedded newlines directly makes stack frames readable in a
    // <pre>, whereas JSON.stringify would show them as the two characters \n.
    return JSON.stringify(formatExceptionJson(value), null, 2).replace(/\\n/g, '\n');
}

export class RowDetailsView implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private selection: ResultRowSelection | undefined;
    private wordWrap = true;

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage(message => {
            if (message?.command !== 'toggleWordWrap') return;
            this.wordWrap = !this.wordWrap;
            this.render();
        });
        this.render();
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) this.view = undefined;
        });
    }

    show(selection: ResultRowSelection): void {
        if (this.selection?.table === selection.table &&
            this.selection.rowIndexes.length === selection.rowIndexes.length &&
            this.selection.rowIndexes.every((row, index) => row === selection.rowIndexes[index])) {
            return;
        }
        this.selection = selection;
        this.render();
    }

    private render(): void {
        if (!this.view) return;
        this.view.webview.html = this.buildHtml(this.selection);
    }

    private buildHtml(selection: ResultRowSelection | undefined): string {
        const body = !selection || selection.rowIndexes.length === 0
            ? '<p class="empty">Select a result row to inspect its values here.</p>'
            : this.buildSelection(selection);
        const wrapClass = this.wordWrap ? '' : 'no-wrap';
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); margin: 0; }
            header { border-bottom: 1px solid var(--vscode-panel-border); padding: 10px 12px 8px; position: sticky; top: 0; background: var(--vscode-sideBar-background); }
            h1 { font-size: 13px; font-weight: 600; margin: 0 0 3px; }
            .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
            button { background: transparent; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; font-size: 11px; margin-top: 7px; padding: 2px 5px; }
            button:hover { background: var(--vscode-toolbar-hoverBackground); }
            input[type="search"] { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 2px; color: var(--vscode-input-foreground); font: inherit; margin-top: 7px; padding: 3px 5px; width: calc(100% - 12px); }
            .empty { color: var(--vscode-descriptionForeground); line-height: 1.45; margin: 14px 12px; }
            dl { margin: 0; }
            .field { border-bottom: 1px solid var(--vscode-widget-border); padding: 9px 12px; }
            dt { color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-textLink-foreground)); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
            .type { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: normal; margin-left: 6px; }
            dd { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; user-select: text; }
            .null { color: var(--vscode-descriptionForeground); font-style: italic; }
            pre { background: var(--vscode-textCodeBlock-background); border-radius: 3px; margin: 0; overflow: auto; padding: 7px; white-space: pre-wrap; }
            body.no-wrap dd, body.no-wrap pre { overflow-wrap: normal; white-space: pre; }
            mark { background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055); color: inherit; }
        </style></head><body class="${wrapClass}"><main data-row-details>${body}</main><script>
            const vscode = acquireVsCodeApi();
            document.querySelector('[data-command="toggleWordWrap"]')?.addEventListener('click', () => vscode.postMessage({ command: 'toggleWordWrap' }));
            const findInput = document.querySelector('[data-find]');
            const details = document.querySelector('[data-row-details]');
            function clearHighlights() {
                details.querySelectorAll('mark[data-find-match]').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent)));
                details.normalize();
            }
            function highlight(query) {
                clearHighlights();
                if (!query) return;
                const queryLower = query.toLocaleLowerCase();
                const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT);
                const textNodes = [];
                while (walker.nextNode()) textNodes.push(walker.currentNode);
                let firstMatch;
                textNodes.forEach(node => {
                    const text = node.textContent;
                    const lower = text.toLocaleLowerCase();
                    let start = 0;
                    let index = lower.indexOf(queryLower, start);
                    if (index === -1) return;
                    const fragment = document.createDocumentFragment();
                    while (index !== -1) {
                        fragment.append(document.createTextNode(text.slice(start, index)));
                        const mark = document.createElement('mark');
                        mark.dataset.findMatch = 'true';
                        mark.textContent = text.slice(index, index + query.length);
                        fragment.append(mark);
                        if (!firstMatch) firstMatch = mark;
                        start = index + query.length;
                        index = lower.indexOf(queryLower, start);
                    }
                    fragment.append(document.createTextNode(text.slice(start)));
                    node.replaceWith(fragment);
                });
                firstMatch?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            findInput?.addEventListener('input', () => highlight(findInput.value));
            document.addEventListener('keydown', event => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
                    event.preventDefault();
                    findInput?.focus();
                    findInput?.select();
                }
                if (event.key === 'Escape' && document.activeElement === findInput) {
                    findInput.value = '';
                    highlight('');
                }
            });
        </script></body></html>`;
    }

    private buildSelection(selection: ResultRowSelection): string {
        const merged = this.findMergedFields(selection.table, selection.rowIndexes);
        if (merged.length === 0) return this.buildRow(selection.table, selection.rowIndexes[0]!);
        const fields = merged.map(field =>
            `<div class="field"><dt>${escapeHtml(field.name)}<span class="type">merged ${field.total}-part message</span></dt><dd>${this.formatMergedValue(field.value)}</dd></div>`
        ).join('');
        return `${this.buildHeader(selection.table.name, `${selection.rowIndexes.length} selected rows · multi-part message assembled`)}<dl>${fields}</dl>`;
    }

    private buildRow(table: ResultTable, rowIndex: number): string {
        const row = table.rows[rowIndex] ?? [];
        const fields = table.columns.map((column, index) => {
            const value = row[index];
            return `<div class="field"><dt>${escapeHtml(column.name)}<span class="type">${escapeHtml(column.type)}</span></dt><dd>${this.formatValue(value, column.type)}</dd></div>`;
        }).join('');
        return `${this.buildHeader(table.name, `Row ${rowIndex + 1} · ${table.columns.length} fields`)}<dl>${fields}</dl>`;
    }

    private formatValue(value: unknown, type: string): string {
        if (value === null || value === undefined) return '<span class="null">null</span>';
        if (type === 'dynamic' && typeof value === 'object') {
            return `<pre>${escapeHtml(formatExceptionJsonForDisplay(value))}</pre>`;
        }
        return escapeHtml(typeof value === 'string' ? value : String(value));
    }

    /** Finds only complete, unambiguous `1/N:` … `N/N:` sequences. */
    private findMergedFields(table: ResultTable, rowIndexes: number[]): Array<{ name: string; total: number; value: string }> {
        if (rowIndexes.length < 2) return [];
        return table.columns.flatMap((column, columnIndex) => {
            const parts = rowIndexes.map(rowIndex => this.parseMultipart(table.rows[rowIndex]?.[columnIndex]));
            if (parts.some(part => !part)) return [];
            const messageParts = parts as Array<{ part: number; total: number; value: string }>;
            const total = messageParts[0]!.total;
            if (total !== rowIndexes.length || messageParts.some(part => part.total !== total)) return [];
            const byPart = new Map(messageParts.map(part => [part.part, part]));
            if (byPart.size !== total || Array.from({ length: total }, (_, i) => !byPart.has(i + 1)).some(Boolean)) return [];
            return [{ name: column.name, total, value: Array.from(byPart.values()).sort((a, b) => a.part - b.part).map(part => part.value).join('') }];
        });
    }

    private parseMultipart(value: unknown): { part: number; total: number; value: string } | undefined {
        if (typeof value !== 'string') return undefined;
        const match = /^(\d+)\s*\/\s*(\d+)\s*:\s?([\s\S]*)$/.exec(value);
        if (!match) return undefined;
        const part = Number(match[1]);
        const total = Number(match[2]);
        if (!Number.isInteger(part) || !Number.isInteger(total) || part < 1 || total < 2 || part > total) return undefined;
        return { part, total, value: match[3] ?? '' };
    }

    private formatMergedValue(value: string): string {
        try {
            return `<pre>${escapeHtml(formatExceptionJsonForDisplay(JSON.parse(value)))}</pre>`;
        } catch {
            return escapeHtml(value);
        }
    }

    private buildHeader(tableName: string, details: string): string {
        const wrapLabel = this.wordWrap ? 'Wrap lines: On' : 'Wrap lines: Off';
        return `<header><h1>${escapeHtml(tableName)}</h1><div class="meta">${escapeHtml(details)}</div><input type="search" data-find placeholder="Find in row" aria-label="Find in row"><button type="button" data-command="toggleWordWrap">${wrapLabel}</button></header>`;
    }

}
