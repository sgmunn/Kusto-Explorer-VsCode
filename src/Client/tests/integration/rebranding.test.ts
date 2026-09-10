// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { HistoryManager } from '../../features/historyManager';

suite('KustoTraceTools standalone extension', () => {
    let extension: vscode.Extension<{ historyManager: HistoryManager }>;
    let fixtureDirectory: vscode.Uri;

    suiteSetup(async () => {
        const found = vscode.extensions.getExtension<{ historyManager: HistoryManager }>('local.kustotracetools');
        assert.ok(found, 'The separately installable KustoTraceTools extension must be discovered');
        extension = found;
        await extension.activate();
        fixtureDirectory = vscode.Uri.file(path.join(os.tmpdir(), `kustotracetools-smoke-${Date.now()}`));
        await vscode.workspace.fs.createDirectory(fixtureDirectory);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (fixtureDirectory) {
            await vscode.workspace.fs.delete(fixtureDirectory, { recursive: true });
        }
    });

    test('activates under its independent identity and registers contributed commands', async () => {
        assert.strictEqual(extension.packageJSON.displayName, 'KustoTraceTools');
        assert.ok(extension.isActive);
        const commands = new Set(await vscode.commands.getCommands(true));
        for (const contribution of extension.packageJSON.contributes.commands as Array<{ command: string }>) {
            assert.ok(contribution.command.startsWith('kustoTraceTools.'), contribution.command);
            assert.ok(commands.has(contribution.command), `Missing command registration: ${contribution.command}`);
        }
    });

    test('keeps local history beneath its own extension storage', async () => {
        const uri = extension.exports.historyManager.getHistoryFileUri('rebranding-smoke.kqr');
        assert.ok(uri.fsPath.split(path.sep).includes('local.kustotracetools'), uri.fsPath);
        assert.ok(!uri.fsPath.includes('ms-kusto.kusto-explorer-vscode'), uri.fsPath);
    });

    test('recognizes existing KQL file extensions', async () => {
        for (const suffix of ['kql', 'csl', 'kusto']) {
            const uri = vscode.Uri.joinPath(fixtureDirectory, `query.${suffix}`);
            await vscode.workspace.fs.writeFile(uri, Buffer.from('print Value = 42'));
            const document = await vscode.workspace.openTextDocument(uri);
            assert.strictEqual(document.languageId, 'kusto', `${suffix} must retain Kusto language support`);
        }
    });

    test('opens saved results with the newly registered custom editor', async () => {
        const uri = vscode.Uri.joinPath(fixtureDirectory, 'saved-result.kqr');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({
            query: 'print Value = 42',
            tables: [{ name: 'PrimaryResult', columns: [{ name: 'Value', type: 'long' }], rows: [[42]] }],
        })));
        await vscode.commands.executeCommand('vscode.openWith', uri, 'kustoTraceTools_resultViewer');
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const opened = vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => {
                const input = tab.input;
                return input instanceof vscode.TabInputCustom
                    && input.uri.toString() === uri.toString()
                    && input.viewType === 'kustoTraceTools_resultViewer';
            });
            if (opened) { return; }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.fail('Saved results did not open in the KustoTraceTools results editor');
    });
});
