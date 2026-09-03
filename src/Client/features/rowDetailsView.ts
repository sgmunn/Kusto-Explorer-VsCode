// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** A compact inspector for the row currently selected in a results grid. */

import * as vscode from 'vscode';
import type { ResultTable } from './server';
import type { ResultRowSelection } from './dataTableProvider';
import { escapeHtml } from './html';

export const rowDetailsViewId = 'msKustoExplorer_rowDetails';

export class RowDetailsView implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private selection: ResultRowSelection | undefined;

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: false };
        this.render();
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) this.view = undefined;
        });
    }

    show(selection: ResultRowSelection): void {
        this.selection = selection;
        this.render();
    }

    private render(): void {
        if (!this.view) return;
        this.view.webview.html = this.buildHtml(this.selection);
    }

    private buildHtml(selection: ResultRowSelection | undefined): string {
        const body = !selection
            ? '<p class="empty">Select a result row to inspect its values here.</p>'
            : this.buildRow(selection.table, selection.rowIndex);
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); margin: 0; }
            header { border-bottom: 1px solid var(--vscode-panel-border); padding: 10px 12px 8px; position: sticky; top: 0; background: var(--vscode-sideBar-background); }
            h1 { font-size: 13px; font-weight: 600; margin: 0 0 3px; }
            .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
            .empty { color: var(--vscode-descriptionForeground); line-height: 1.45; margin: 14px 12px; }
            dl { margin: 0; }
            .field { border-bottom: 1px solid var(--vscode-widget-border); padding: 9px 12px; }
            dt { color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-textLink-foreground)); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
            .type { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: normal; margin-left: 6px; }
            dd { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; user-select: text; }
            .null { color: var(--vscode-descriptionForeground); font-style: italic; }
            pre { background: var(--vscode-textCodeBlock-background); border-radius: 3px; margin: 0; overflow: auto; padding: 7px; white-space: pre-wrap; }
        </style></head><body>${body}</body></html>`;
    }

    private buildRow(table: ResultTable, rowIndex: number): string {
        const row = table.rows[rowIndex] ?? [];
        const fields = table.columns.map((column, index) => {
            const value = row[index];
            return `<div class="field"><dt>${escapeHtml(column.name)}<span class="type">${escapeHtml(column.type)}</span></dt><dd>${this.formatValue(value, column.type)}</dd></div>`;
        }).join('');
        return `<header><h1>${escapeHtml(table.name)}</h1><div class="meta">Row ${rowIndex + 1} · ${table.columns.length} fields</div></header><dl>${fields}</dl>`;
    }

    private formatValue(value: unknown, type: string): string {
        if (value === null || value === undefined) return '<span class="null">null</span>';
        if (type === 'dynamic' && typeof value === 'object') {
            return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
        }
        return escapeHtml(typeof value === 'string' ? value : String(value));
    }

}
