// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { CompositeChartProvider } from '../../features/compositeChartProvider';
import { DocumentViewProvider, WebViewAdapter } from '../../features/resultsViewer';
import type { ResultTable } from '../../features/server';

function createMockVsCodeWebview(): vscode.Webview {
    return {
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(() => ({ dispose: () => { } })),
    } as unknown as vscode.Webview;
}

describe('WebViewAdapter', () => {
    it('keeps setup dependencies from all chart providers sharing the same region', () => {
        const adapter = new WebViewAdapter(createMockVsCodeWebview());

        const view = new CompositeChartProvider().createView(adapter);

        expect(adapter.headHtml).toContain('plotly');
        expect(adapter.headHtml).toContain('cytoscape');
        expect(adapter.scriptsHtml).toContain('setChartContent');
        expect(adapter.scriptsHtml).toContain('chartViewReady');

        view.dispose();
    });

    it('separates accumulated setup fragments with newlines', () => {
        const adapter = new WebViewAdapter(createMockVsCodeWebview());

        adapter.setup('<meta name="first">', '<script>first();</script>');
        adapter.setup('<meta name="second">', '<script>second();</script>');

        expect(adapter.headHtml).toBe('<meta name="first">\n<meta name="second">');
        expect(adapter.scriptsHtml).toBe('<script>first();</script>\n<script>second();</script>');
    });

    it('does not duplicate identical setup fragments', () => {
        const adapter = new WebViewAdapter(createMockVsCodeWebview());

        adapter.setup('<meta name="same">', '<script>same();</script>');
        adapter.setup('<meta name="same">', '<script>same();</script>');

        expect(adapter.headHtml).toBe('<meta name="same">');
        expect(adapter.scriptsHtml).toBe('<script>same();</script>');
    });
});

describe('DocumentViewProvider HTML', () => {
    const table: ResultTable = {
        name: 'PrimaryResult',
        columns: [{ name: 'Value', type: 'string' }],
        rows: [['one']],
    };

    function buildHtml(hasChart: boolean, includeStructured = false): string {
        const builder = Object.create(DocumentViewProvider.prototype) as DocumentViewProvider;
        const tableWebView = { contentHtml: '<table data-test="result-grid"></table>' } as WebViewAdapter;
        const structuredWebView = { contentHtml: '<table data-test="structured-grid"></table>' } as WebViewAdapter;
        return builder.BuildMultiTabbedHtml(
            hasChart,
            'all',
            undefined,
            undefined,
            undefined,
            'print 1',
            undefined,
            undefined,
            [table],
            [tableWebView],
            includeStructured ? [{ tableIndex: 0, webView: structuredWebView }] : undefined,
        );
    }

    it('makes the first table visible before its inline grid script runs', () => {
        const html = buildHtml(false);

        expect(html).toContain('<div id="table-0" class="view-content active"');
    });

    it('keeps the table initially hidden when a chart is the first view', () => {
        const html = buildHtml(true);

        expect(html).toContain('<div id="table-0" class="view-content"');
        expect(html).not.toContain('<div id="table-0" class="view-content active"');
    });

    it('adds a structured data tab beside the normal data tab', () => {
        const html = buildHtml(false, true);

        expect(html).toContain('data-view="structured-table-0"');
        expect(html).toContain('>Data - Structured</button>');
        expect(html).toContain('<div id="structured-table-0" class="view-content"');
        expect(html).toContain('<table data-test="structured-grid"></table>');
    });
});
