// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import type { IServer, RunQueryResult } from '../../features/server';
import type { HistoryManager } from '../../features/historyManager';

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        if (Date.now() > deadline) { throw new Error(message); }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

function result(label: string): RunQueryResult {
    return { data: { query: label, tables: [{ name: 'PrimaryResult',
        columns: [{ name: 'Value', type: 'string' }], rows: [[label]] }] } };
}

interface PendingRun {
    token: vscode.CancellationToken;
    resolve: (value: RunQueryResult) => void;
}

suite('Query Cancellation Integration Tests', () => {
    let server: IServer;
    let history: HistoryManager;
    let originalRunQuery: IServer['runQuery'];
    let originalGetRanges: IServer['getQueryRanges'];
    let originalShowError: typeof vscode.window.showErrorMessage;
    let pending: PendingRun[];
    let errors: string[];
    let originalDisplay: string | undefined;
    let originalEditorMode: string | undefined;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('ms-kusto.kusto-explorer-vscode')!;
        const exports = extension.isActive ? extension.exports : await extension.activate();
        server = exports.server;
        history = exports.historyManager;
        const config = vscode.workspace.getConfiguration('msKustoExplorer.results');
        originalDisplay = config.inspect<string>('display')?.globalValue;
        originalEditorMode = config.inspect<string>('editorMode')?.globalValue;
        await config.update('display', 'beside', vscode.ConfigurationTarget.Global);
        await config.update('editorMode', 'newTab', vscode.ConfigurationTarget.Global);
    });

    suiteTeardown(async () => {
        const config = vscode.workspace.getConfiguration('msKustoExplorer.results');
        await config.update('display', originalDisplay, vscode.ConfigurationTarget.Global);
        await config.update('editorMode', originalEditorMode, vscode.ConfigurationTarget.Global);
    });

    setup(() => {
        pending = [];
        errors = [];
        originalRunQuery = server.runQuery;
        originalGetRanges = server.getQueryRanges;
        originalShowError = vscode.window.showErrorMessage;
        (server as any).runQuery = (...args: unknown[]) => new Promise<RunQueryResult>(resolve => {
            const token = args[7] as vscode.CancellationToken;
            assert.ok(token, 'Every user-triggered query must receive a cancellation token');
            pending.push({ token, resolve });
        });
        (vscode.window as any).showErrorMessage = async (message: string) => { errors.push(message); };
    });

    teardown(async () => {
        for (const run of pending) { run.resolve({}); }
        server.runQuery = originalRunQuery;
        server.getQueryRanges = originalGetRanges;
        vscode.window.showErrorMessage = originalShowError;
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('Cancel CodeLens targets one range, discards late results, and allows another run', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'kusto',
            content: 'print first=1\n\nprint second=2' });
        await vscode.window.showTextDocument(document);
        const ranges = [0, 2].map(line => ({ start: { line, character: 0 },
            end: { line, character: document.lineAt(line).text.length } }));
        server.getQueryRanges = async () => ({ uri: document.uri.toString(), ranges });
        const before = history.getEntries().length;
        const first = vscode.commands.executeCommand('msKustoExplorer.runQuery', 0, 0, 0, 13);
        await waitUntil(() => pending.length === 1, 'First query did not start');
        const second = vscode.commands.executeCommand('msKustoExplorer.runQuery', 2, 0, 2, 14);
        await waitUntil(() => pending.length === 2, 'Second query did not start');
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
            'vscode.executeCodeLensProvider', document.uri);
        const cancel = lenses?.find(lens => lens.range.start.line === 0
            && lens.command?.command === 'msKustoExplorer.cancelQuery')?.command;
        assert.ok(cancel, 'Running query must expose its Cancel CodeLens');
        await vscode.commands.executeCommand(cancel.command, ...cancel.arguments!);
        assert.strictEqual(pending[0]!.token.isCancellationRequested, true);
        assert.strictEqual(pending[1]!.token.isCancellationRequested, false,
            'Cancelling one range must not cancel another');
        await Promise.race([first, new Promise((_, reject) => setTimeout(() => reject(new Error(
            'Cancelled query must complete without waiting for its server response')), 1000))]);
        pending[0]!.resolve(result('discarded cancelled result'));
        pending[1]!.resolve(result('surviving query'));
        await Promise.all([first, second]);
        assert.strictEqual(history.getEntries().length, before + 1);
        assert.strictEqual((await history.getEntryData(history.getEntries()[0]!))?.query, 'surviving query');
        assert.deepStrictEqual(errors, [], 'Cancellation must not produce an execution error');
        await vscode.window.showTextDocument(document);
        const after = await vscode.commands.executeCommand<vscode.CodeLens[]>(
            'vscode.executeCodeLensProvider', document.uri);
        assert.ok(!after?.some(lens => lens.command?.command === 'msKustoExplorer.cancelQuery'),
            'Cancel controls must clear after completion');
        const next = vscode.commands.executeCommand('msKustoExplorer.runQuery', 0, 0, 0, 13);
        await waitUntil(() => pending.length === 3, 'Subsequent query did not start');
        assert.strictEqual(pending[2]!.token.isCancellationRequested, false);
        pending[2]!.resolve(result('subsequent query'));
        await next;
        assert.strictEqual(history.getEntries().length, before + 2);
    });

    test('toolbar cancellation cancels only the newest run in the active document', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'kusto', content: 'print value=1' });
        await vscode.window.showTextDocument(document);
        const before = history.getEntries().length;
        const first = vscode.commands.executeCommand('msKustoExplorer.runQuery', 0, 0, 0, 13);
        await waitUntil(() => pending.length === 1, 'First query did not start');
        const second = vscode.commands.executeCommand('msKustoExplorer.runQuery', 0, 0, 0, 13);
        await waitUntil(() => pending.length === 2, 'Overlapping query did not start');
        await vscode.commands.executeCommand('msKustoExplorer.cancelQuery');
        assert.strictEqual(pending[0]!.token.isCancellationRequested, false);
        assert.strictEqual(pending[1]!.token.isCancellationRequested, true);
        pending[1]!.resolve({ error: { message: 'late cancellation response' } } as RunQueryResult);
        pending[0]!.resolve(result('older surviving run'));
        await Promise.all([first, second]);
        assert.strictEqual(history.getEntries().length, before + 1);
        assert.deepStrictEqual(errors, []);
    });

    test('cancelling Results Rerun preserves its document and suppresses late data', async () => {
        const uri = vscode.Uri.file(path.join(os.tmpdir(), `cancellation-rerun-${Date.now()}.kqr`));
        const originalContent = JSON.stringify(result('original result').data, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(originalContent));
        const document = await vscode.workspace.openTextDocument(uri);
        const originalProgress = vscode.window.withProgress;
        const source = new vscode.CancellationTokenSource();
        try {
            await vscode.commands.executeCommand('vscode.openWith', uri, 'msKustoExplorer_resultViewer');
            // Keep the real progress UI but supply a token that this test can cancel.
            (vscode.window as any).withProgress = (options: vscode.ProgressOptions, task: any) => {
                assert.strictEqual(options.cancellable, true, 'Rerun progress must offer Cancel');
                return originalProgress(options, progress => task(progress, source.token));
            };
            const before = history.getEntries().length;
            const run = vscode.commands.executeCommand('msKustoExplorer.rerunQuery');
            await waitUntil(() => pending.length === 1, 'Results rerun did not start');
            source.cancel();
            await waitUntil(() => pending[0]!.token.isCancellationRequested, 'Rerun token was not cancelled');
            pending[0]!.resolve(result('late replacement data'));
            await run;
            assert.strictEqual(document.getText(), originalContent, 'Cancelled rerun must preserve open result data');
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), originalContent,
                'Cancelled rerun must preserve the saved result');
            assert.strictEqual(document.isDirty, false);
            assert.strictEqual(history.getEntries().length, before);
            assert.deepStrictEqual(errors, []);
        } finally {
            vscode.window.withProgress = originalProgress;
            source.dispose();
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            await vscode.workspace.fs.delete(uri);
        }
    });
});
