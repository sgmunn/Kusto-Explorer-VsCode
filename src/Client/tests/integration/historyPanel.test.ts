// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as vscode from 'vscode';

// Type imports for HistoryManager — resolved at compile time only
import type { HistoryManager } from '../../features/historyManager';
import type { ResultData } from '../../features/server';

/** Helper: build a minimal ResultData for testing. */
function makeResultData(query: string, cluster?: string, database?: string, rowCount = 1): ResultData {
    const rows = Array.from({ length: rowCount }, (_, i) => [i]);
    return {
        query,
        cluster,
        database,
        tables: [{ name: 'PrimaryResult', columns: [{ name: 'value', type: 'int' }], rows }],
    };
}

/** Get the extension's exported HistoryManager instance. */
async function getHistoryManager(): Promise<HistoryManager> {
    const ext = vscode.extensions.getExtension('ms-kusto.kusto-explorer-vscode')!;
    // activate() returns cached exports if already activated
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return (exports as any).historyManager as HistoryManager;
}

suite('History Integration Tests', () => {
    let historyManager: HistoryManager;

    suiteSetup(async () => {
        historyManager = await getHistoryManager();
    });

    setup(async () => {
        // Clear any leftover history from prior tests or test runs
        await historyManager.clearAllEntries();
    });

    teardown(async () => {
        // Clear all history entries after each test to start fresh
        await historyManager.clearAllEntries();
    });

    test('Platform-specific reveal commands are registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('msKustoExplorer.revealHistoryItemInFinder'));
        assert.ok(commands.includes('msKustoExplorer.revealHistoryItemInExplorer'));
        assert.ok(commands.includes('msKustoExplorer.revealHistoryItemInFileManager'));
        assert.ok(commands.includes('msKustoExplorer.copyHistoryItemToWorkspace'));
    });

    test('Adding a history entry creates a retrievable entry', async () => {
        const entriesBefore = historyManager.getEntries();
        assert.strictEqual(entriesBefore.length, 0, 'Should start with no entries');

        await historyManager.addHistoryEntry(makeResultData('StormEvents | take 10', 'https://help.kusto.windows.net', 'Samples'));

        const entriesAfter = historyManager.getEntries();
        assert.strictEqual(entriesAfter.length, 1, 'Should have one entry after adding');
        assert.ok(entriesAfter[0].queryPreview.includes('StormEvents'), 'Query preview should contain query text');
        assert.strictEqual(entriesAfter[0].cluster, 'https://help.kusto.windows.net');
        assert.strictEqual(entriesAfter[0].database, 'Samples');
        assert.strictEqual(entriesAfter[0].rowCount, 1);
    });

    test('Deleting a history item removes it', async () => {
        await historyManager.addHistoryEntry(makeResultData('query1'));
        await historyManager.addHistoryEntry(makeResultData('query2'));

        let entries = historyManager.getEntries();
        assert.strictEqual(entries.length, 2);

        // Delete the first entry (most recent = query2)
        await vscode.commands.executeCommand('msKustoExplorer.deleteHistoryItem', { meta: entries[0] });

        entries = historyManager.getEntries();
        assert.strictEqual(entries.length, 1, 'Should have one entry after deletion');
        assert.ok(entries[0].queryPreview.includes('query1'), 'Remaining entry should be query1');
    });

    test('Clear all history removes everything after confirmation', async () => {
        await historyManager.addHistoryEntry(makeResultData('q1'));
        await historyManager.addHistoryEntry(makeResultData('q2'));
        await historyManager.addHistoryEntry(makeResultData('q3'));
        assert.strictEqual(historyManager.getEntries().length, 3);

        // Stub showWarningMessage to confirm the delete
        const original = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => 'Delete All';
        try {
            await vscode.commands.executeCommand('msKustoExplorer.clearHistory');
        } finally {
            (vscode.window as any).showWarningMessage = original;
        }

        const entries = historyManager.getEntries();
        assert.strictEqual(entries.length, 0, 'All history should be cleared');
    });

    test('History file persists on disk and is readable', async () => {
        const resultData = makeResultData('persist test', 'cluster1', 'db1', 5);
        const uri = await historyManager.addHistoryEntry(resultData);

        // Verify the file exists on disk
        const stat = await vscode.workspace.fs.stat(uri);
        assert.ok(stat.size > 0, 'History file should exist and have content');

        // Verify the data can be read back
        const readBack = await historyManager.readHistoryFile(uri);
        assert.ok(readBack, 'Should be able to read back the history file');
        assert.strictEqual(readBack!.query, 'persist test');
        assert.strictEqual(readBack!.cluster, 'cluster1');
        assert.strictEqual(readBack!.database, 'db1');
        assert.strictEqual(readBack!.tables[0].rows.length, 5);
    });

    test('Newest entry appears first in history', async () => {
        await historyManager.addHistoryEntry(makeResultData('first query'));
        await historyManager.addHistoryEntry(makeResultData('second query'));
        await historyManager.addHistoryEntry(makeResultData('third query'));

        const entries = historyManager.getEntries();
        assert.strictEqual(entries.length, 3, 'Should have three entries');

        // Most recent should be first
        assert.ok(entries[0].queryPreview.includes('third'), `First entry should be "third query", got: ${entries[0].queryPreview}`);
        assert.ok(entries[1].queryPreview.includes('second'), `Second entry should be "second query", got: ${entries[1].queryPreview}`);
        assert.ok(entries[2].queryPreview.includes('first'), `Third entry should be "first query", got: ${entries[2].queryPreview}`);

        // Timestamps should be in descending order
        const t0 = new Date(entries[0].timestamp).getTime();
        const t1 = new Date(entries[1].timestamp).getTime();
        const t2 = new Date(entries[2].timestamp).getTime();
        assert.ok(t0 >= t1, 'First entry timestamp should be >= second');
        assert.ok(t1 >= t2, 'Second entry timestamp should be >= third');
    });
});
