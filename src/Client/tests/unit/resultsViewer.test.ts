// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CompositeChartProvider } from '../../features/compositeChartProvider';
import { DocumentViewProvider, ResultsViewer, WebViewAdapter } from '../../features/resultsViewer';
import type { ResultData, ResultTable } from '../../features/server';

vi.mock('vscode', async (importOriginal) => {
    const original = await importOriginal<typeof import('vscode')>();
    return {
        ...original,
        commands: { executeCommand: vi.fn(async () => undefined) },
        window: { ...original.window, activeColorTheme: { kind: 1 } },
        ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    };
});

describe('ResultsViewer panel badge', () => {
    const oldBadge = { tooltip: '12 rows', value: 12 };

    function createPanel(failures = 0): vscode.WebviewView {
        let html = '<html>previous results</html>';
        return {
            badge: oldBadge,
            webview: {
                get html() { return html; },
                set html(value: string) {
                    if (failures-- > 0) throw new Error('Webview unavailable');
                    html = value;
                },
                onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
            },
            show: vi.fn(),
        } as unknown as vscode.WebviewView;
    }

    function createViewer(panel: vscode.WebviewView | undefined) {
        const viewer = Object.create(ResultsViewer.prototype) as ResultsViewer;
        const state = {
            resultsPanel: panel,
            panelRenderRevision: 0,
            panelTableViews: [],
            panelTableWebViews: [],
            htmlBuilder: { BuildMultiTabbedHtml: vi.fn(() => '<html>new results</html>') },
            dataTableProvider: {
                createView: vi.fn(() => ({ dispose: vi.fn(), onDidChangeViewState: vi.fn() })),
            },
        };
        Object.assign(viewer, state);
        return { viewer, state: viewer as unknown as typeof state & { waitForPanelReady?: () => Promise<void> } };
    }

    function result(...rowCounts: number[]): ResultData {
        return {
            tables: rowCounts.map((count, index) => ({
                name: `Table${index}`,
                columns: [{ name: 'Value', type: 'int' }],
                rows: Array.from({ length: count }, (_, row) => [row]),
            })),
        };
    }

    beforeEach(() => vi.mocked(vscode.commands.executeCommand).mockReset());

    it.each([0, 1])('updates count, empty, error and no-table badges with %i render failures', async (failures) => {
        const panel = createPanel(failures);
        const { viewer } = createViewer(panel);

        await viewer.displayResultsInBottomPanel(result(2, 3), 'data');
        expect(panel.badge).toEqual({ tooltip: '5 rows', value: 5 });
        await viewer.displayResultsInBottomPanel(result(0), 'data');
        expect(panel.badge).toBeUndefined();
        await viewer.displayErrorInBottomView({ message: 'Query failed' });
        expect(panel.badge).toEqual({ tooltip: 'Error', value: 1 });
        await viewer.displayResultsInBottomPanel(result(), 'data');
        expect(panel.badge).toBeUndefined();
    });

    it.each(['empty', 'error'] as const)('sets the %s badge on a replacement panel during retry', async (selection) => {
        const { viewer, state } = createViewer(createPanel(1));
        const replacement = createPanel();
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command) => {
            if (command === 'msKustoExplorer_resultsView.focus') state.resultsPanel = replacement;
        });

        if (selection === 'empty') await viewer.displayResultsInBottomPanel(result(0), 'data');
        else await viewer.displayErrorInBottomView({ message: 'Query failed' });

        expect(replacement.badge).toEqual(selection === 'empty' ? undefined : { tooltip: 'Error', value: 1 });
        expect(replacement.webview.html).not.toContain('previous results');
    });

    it.each([result(0), result()])('clears the badge before an empty render fails', async (emptyResult) => {
        const panel = createPanel(2);
        const { viewer } = createViewer(panel);

        const display = viewer.displayResultsInBottomPanel(emptyResult, 'data');
        if (emptyResult.tables.length) await expect(display).resolves.toBeUndefined();
        else await expect(display).rejects.toThrow('Webview unavailable');

        expect(panel.badge).toBeUndefined();
    });

    it.each([result(0), result()])('keeps a newer empty selection when an older display retry resumes', async (emptyResult) => {
        const panel = createPanel(1);
        const { viewer } = createViewer(panel);
        let resumeFocus!: () => void;
        const focus = new Promise<void>(resolve => { resumeFocus = resolve; });
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command) => {
            if (command === 'msKustoExplorer_resultsView.focus') await focus;
        });

        const olderDisplay = viewer.displayResultsInBottomPanel(result(4), 'data');
        await viewer.displayResultsInBottomPanel(emptyResult, 'data');
        const selectedHtml = panel.webview.html;
        resumeFocus();
        await olderDisplay;

        expect(panel.badge).toBeUndefined();
        expect(panel.webview.html).toBe(selectedHtml);
    });

    it('keeps a newer empty selection while an older display waits for the panel', async () => {
        const { viewer, state } = createViewer(undefined);
        let ready!: () => void;
        state.waitForPanelReady = () => new Promise<void>(resolve => { ready = resolve; });

        const olderDisplay = viewer.displayResultsInBottomPanel(result(4), 'data');
        const panel = createPanel();
        state.resultsPanel = panel;
        await viewer.displayResultsInBottomPanel(result(), 'data');
        ready();
        await olderDisplay;

        expect(panel.badge).toBeUndefined();
        expect(panel.webview.html).toContain('no results');
    });
});

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
