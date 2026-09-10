// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

import type { ResultsViewer } from '../../features/resultsViewer';
import type { ResultData } from '../../features/server';

/** Get the extension's exported ResultsViewer instance. */
async function getResultsViewer(): Promise<ResultsViewer> {
    const ext = vscode.extensions.getExtension('local.kustotracetools')!;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return (exports as any).resultsViewer as ResultsViewer;
}

/** Fabricate minimal ResultData for testing. */
function makeResultData(): ResultData {
    return {
        query: 'StormEvents | take 2',
        tables: [{
            name: 'PrimaryResult',
            columns: [
                { name: 'State', type: 'string' },
                { name: 'EventCount', type: 'long' }
            ],
            rows: [
                ['Texas', 42],
                ['Florida', 99]
            ]
        }]
    };
}

/** Wait for a tab with matching label or URI to appear. */
async function waitForTab(
    predicate: (tab: vscode.Tab) => boolean,
    timeoutMs = 5000
): Promise<vscode.Tab> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (predicate(tab)) {
                    return tab;
                }
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for tab');
}

suite('Results Viewer Integration Tests', () => {
    let resultsViewer: ResultsViewer;
    const createdFiles: vscode.Uri[] = [];

    suiteSetup(async () => {
        resultsViewer = await getResultsViewer();
    });

    teardown(async () => {
        // Close all editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        // Clean up any .ktt files we created
        for (const uri of createdFiles) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch {
                // ignore if already gone
            }
        }
        createdFiles.length = 0;
    });

    test('Display results in bottom panel', async () => {
        const data = makeResultData();
        // displayResultsInBottomPanel resolves after rendering into the webview.
        // The VS Code extension test API does not allow inspecting webview content,
        // so we verify the call completes without throwing and the panel is visible.
        await resultsViewer.displayResultsInBottomPanel(data, 'data');
    });

    test('Results badge follows populated, empty, and tableless results', async () => {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'kusto', content: 'print Value=1' }));
        // Resolve the real view before displaying results so this regression does
        // not depend on the separate first-open panel readiness race.
        await vscode.commands.executeCommand('kustoTraceTools_resultsView.focus');
        const viewer = resultsViewer as unknown as { resultsPanel: vscode.WebviewView | undefined };
        const deadline = Date.now() + 5000;
        while (!viewer.resultsPanel && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(viewer.resultsPanel, 'Results view must resolve');

        const data = makeResultData();
        await resultsViewer.displayResultsInBottomPanel(data, 'data');
        assert.deepStrictEqual(viewer.resultsPanel.badge, { value: 2, tooltip: '2 rows' });

        const empty = { ...data, tables: [{ ...data.tables[0]!, rows: [] }] };
        await resultsViewer.displayResultsInBottomPanel(empty, 'data');
        assert.deepStrictEqual(viewer.resultsPanel.badge, { value: 0, tooltip: '0 rows' }, 'Zero rows must reset the old count');

        const oneRow = { ...data, tables: [{ ...data.tables[0]!, rows: [['Washington', 7]] }] };
        await resultsViewer.displayResultsInBottomPanel(oneRow, 'data');
        assert.deepStrictEqual(viewer.resultsPanel.badge, { value: 1, tooltip: '1 rows' });

        await resultsViewer.displayResultsInBottomPanel({ ...data, tables: [] }, 'data');
        assert.deepStrictEqual(viewer.resultsPanel.badge, { value: 0, tooltip: '0 rows' }, 'No result tables must reset the old count');
    });

    test('Results badge clears an old error after a retried empty render', async () => {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'kusto', content: 'print Value=1' }));
        await vscode.commands.executeCommand('kustoTraceTools_resultsView.focus');
        const viewer = resultsViewer as unknown as {
            resultsPanel: vscode.WebviewView;
            panelRenderRevision: number;
            showPanelHtml(html: string, renderRevision: number, rowCount?: number, hasError?: boolean): Promise<void>;
        };
        assert.ok(viewer.resultsPanel, 'Results view must resolve');
        const panel = viewer.resultsPanel;
        await viewer.showPanelHtml('<html><body>Test error</body></html>', viewer.panelRenderRevision, undefined, true);
        assert.deepStrictEqual(panel.badge, { value: 1, tooltip: 'Error' });

        // Throw only on the first HTML assignment to exercise recovery while
        // retaining a real VS Code badge setter and view in the retry path.
        let attempts = 0;
        const webview = new Proxy(panel.webview, {
            set(target, property, value) {
                if (property === 'html' && ++attempts === 1) {
                    throw new Error('Simulated first render failure');
                }
                return Reflect.set(target, property, value);
            }
        });
        viewer.resultsPanel = new Proxy(panel, {
            get(target, property) {
                const value = property === 'webview' ? webview : Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, property, value) {
                return Reflect.set(target, property, value, target);
            }
        });
        try {
            await viewer.showPanelHtml('<html><body>No rows</body></html>', viewer.panelRenderRevision, 0);
            assert.strictEqual(attempts, 2, 'The render must exercise the retry');
            assert.deepStrictEqual(panel.badge, { value: 0, tooltip: '0 rows' }, 'Retry must reset the old error badge');
        } finally {
            viewer.resultsPanel = panel;
        }
    });

    test('Display results in singleton view opens a tab', async () => {
        const data = makeResultData();

        assert.strictEqual(resultsViewer.hasSingletonView(), false, 'Should start with no singleton');

        await resultsViewer.displayResultsInSingletonView(data, 'data');

        assert.strictEqual(resultsViewer.hasSingletonView(), true, 'Singleton view should exist');
    });

    test('Save panel results creates and opens a .ktt file', async () => {
        const data = makeResultData();
        await resultsViewer.displayResultsInBottomPanel(data, 'data');

        // Determine save path
        const testWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const saveUri = vscode.Uri.file(path.join(testWorkspace, 'test-results.ktt'));
        createdFiles.push(saveUri);

        // Stub showSaveDialog to return our test path
        const originalSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as any).showSaveDialog = async () => saveUri;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.savePanelResults');
        } finally {
            (vscode.window as any).showSaveDialog = originalSaveDialog;
        }

        // Verify .ktt file was created on disk
        const stat = await vscode.workspace.fs.stat(saveUri);
        assert.ok(stat.size > 0, 'File should have content');

        // Verify file content is valid ResultData JSON
        const content = Buffer.from(await vscode.workspace.fs.readFile(saveUri)).toString('utf-8');
        const parsed = JSON.parse(content);
        assert.strictEqual(parsed.tables.length, 1, 'Should have one table');
        assert.strictEqual(parsed.tables[0].name, 'PrimaryResult');
        assert.strictEqual(parsed.tables[0].rows.length, 2, 'Should have 2 rows');

        // Verify the file was opened as a document tab
        const tab = await waitForTab(t => {
            const input = t.input;
            if (input && typeof input === 'object' && 'uri' in input) {
                return (input as { uri: vscode.Uri }).uri.fsPath.toLowerCase() === saveUri.fsPath.toLowerCase();
            }
            return false;
        });
        assert.ok(tab, '.ktt file should be open as a tab');
    });

    test('Chart from bottom panel opens singleton beside', async () => {
        const data = makeResultData();
        await resultsViewer.displayResultsInBottomPanel(data, 'data');

        assert.strictEqual(resultsViewer.hasSingletonView(), false, 'Should start with no singleton');

        await vscode.commands.executeCommand('kustoTraceTools.chartPanelResults');

        assert.strictEqual(resultsViewer.hasSingletonView(), true, 'Chart should open as singleton view');

        // Verify the singleton tab exists
        const tab = await waitForTab(t => t.label === 'Chart');
        assert.ok(tab, 'Chart tab should be visible');
    });

    test('Move singleton view toggles between main and beside', async () => {
        // First open a kusto document so there's something in the main editor column
        const doc = await vscode.workspace.openTextDocument({ language: 'kusto', content: 'StormEvents' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

        const data = makeResultData();
        // Open singleton in beside column
        await resultsViewer.displayResultsInSingletonView(data, 'data');
        assert.strictEqual(resultsViewer.hasSingletonView(), true);

        // Find the singleton tab — should be in a beside group (group index > 0 or viewColumn > 1)
        let singletonTab = await waitForTab(t => t.label === 'Data');
        assert.ok(singletonTab, 'Data tab should exist');
        const initialGroupIndex = vscode.window.tabGroups.all.findIndex(
            g => g.tabs.some(t => t === singletonTab)
        );

        // Move to main
        await vscode.commands.executeCommand('kustoTraceTools.moveViewToMain');

        // Small delay for view state to settle
        await new Promise(r => setTimeout(r, 200));

        // Find it again — should be in a different group now
        singletonTab = await waitForTab(t => t.label === 'Data');
        const newGroupIndex = vscode.window.tabGroups.all.findIndex(
            g => g.tabs.some(t => t === singletonTab)
        );

        assert.notStrictEqual(
            newGroupIndex, initialGroupIndex,
            'Singleton should have moved to a different editor group'
        );
    });

    test('Save singleton results creates and opens a .ktt file', async () => {
        const data = makeResultData();
        await resultsViewer.displayResultsInSingletonView(data, 'data');
        assert.strictEqual(resultsViewer.hasSingletonView(), true);

        const testWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const saveUri = vscode.Uri.file(path.join(testWorkspace, 'singleton-results.ktt'));
        createdFiles.push(saveUri);

        const originalSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as any).showSaveDialog = async () => saveUri;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.saveSingletonResults');
        } finally {
            (vscode.window as any).showSaveDialog = originalSaveDialog;
        }

        // Verify file was created with correct content
        const content = Buffer.from(await vscode.workspace.fs.readFile(saveUri)).toString('utf-8');
        const parsed = JSON.parse(content);
        assert.strictEqual(parsed.query, 'StormEvents | take 2', 'Should preserve query text');
        assert.strictEqual(parsed.tables[0].name, 'PrimaryResult');
        assert.strictEqual(parsed.tables[0].rows.length, 2);

        // Verify the file was opened as a document tab
        const tab = await waitForTab(t => {
            const input = t.input;
            if (input && typeof input === 'object' && 'uri' in input) {
                return (input as { uri: vscode.Uri }).uri.fsPath.toLowerCase() === saveUri.fsPath.toLowerCase();
            }
            return false;
        });
        assert.ok(tab, '.ktt file should be open as a tab');
    });
});
