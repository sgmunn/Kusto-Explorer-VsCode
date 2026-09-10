// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as vscode from 'vscode';

/** Close all editors for the given URI scheme and delete the files via the file system provider. */
/** Check if a scratch pad path/name matches one of the keep names exactly (ignoring extension). */
function shouldKeep(nameOrPath: string, keepFiles: string[]): boolean {
    // Extract just the base name without extension from the path
    const baseName = nameOrPath.replace(/^\//, '').replace(/\.kql$/, '');
    return keepFiles.some(f => baseName === f);
}

async function cleanupScratchPads(keepFiles: string[]): Promise<void> {
    // Close all scratch pad tabs except those we're keeping
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input as { uri?: vscode.Uri } | undefined;
            if (input?.uri?.scheme === 'kustoTraceTools-scratch') {
                if (!shouldKeep(input.uri.path, keepFiles)) {
                    await vscode.window.tabGroups.close(tab);
                }
            }
        }
    }

    // Delete all scratch pad files except those we're keeping
    const rootUri = vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' });
    const entries = await vscode.workspace.fs.readDirectory(rootUri);
    for (const [name] of entries) {
        if (!shouldKeep(name, keepFiles)) {
            const fileUri = vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' + name });
            await vscode.workspace.fs.delete(fileUri);
        }
    }
}

suite('Scratch Pad Integration Tests', () => {

    suiteSetup(async () => {
        // Focus the Scratch Pads view to trigger extension activation
        // and the auto-open of ScratchPad1
        await vscode.commands.executeCommand('kustoTraceTools_scratchPads.focus');
        // Wait for activation and auto-open to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    teardown(async () => {
        // Keep only ScratchPad1 (the default), remove anything tests created
        await cleanupScratchPads(['ScratchPad1']);
    });

    test('ScratchPad1 document is open by default', async () => {
        const scratchDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.scheme === 'kustoTraceTools-scratch' && doc.uri.path.includes('ScratchPad1')
        );
        assert.ok(scratchDoc, 'ScratchPad1 should be open after activation');
        assert.strictEqual(scratchDoc.languageId, 'kusto');
    });

    test('kustoTraceTools.newScratchPad creates and opens a new scratch pad', async () => {
        const docsBefore = vscode.workspace.textDocuments.filter(
            doc => doc.uri.scheme === 'kustoTraceTools-scratch'
        );

        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');

        // Wait for the editor to open
        await new Promise(resolve => setTimeout(resolve, 1000));

        const docsAfter = vscode.workspace.textDocuments.filter(
            doc => doc.uri.scheme === 'kustoTraceTools-scratch'
        );
        assert.ok(
            docsAfter.length > docsBefore.length,
            `Expected more scratch pad documents after create (before: ${docsBefore.length}, after: ${docsAfter.length})`
        );

        // The active editor should be the new scratch pad
        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, 'There should be an active editor after creating a scratch pad');
        assert.strictEqual(activeEditor.document.uri.scheme, 'kustoTraceTools-scratch');
        assert.strictEqual(activeEditor.document.languageId, 'kusto');
    });

    test('kustoTraceTools.renameScratchPad renames a scratch pad', async () => {
        // Create a scratch pad to rename
        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the newly created scratch pad name
        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, 'Should have an active editor');
        const originalFileName = activeEditor.document.uri.path.replace(/^\//, '');

        // Stub showInputBox to return the new name (without .kql extension)
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'RenamedPad';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.renameScratchPad', { fileName: originalFileName });
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // The renamed document should now be open
        const renamedDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.scheme === 'kustoTraceTools-scratch' && doc.uri.path.includes('RenamedPad')
        );
        assert.ok(renamedDoc, 'Renamed scratch pad should be open');

        // The active editor should show the renamed file
        const renamedEditor = vscode.window.activeTextEditor;
        assert.ok(renamedEditor, 'Should have an active editor after rename');
        assert.ok(
            renamedEditor.document.uri.path.includes('RenamedPad'),
            `Active editor should be the renamed pad, got: ${renamedEditor.document.uri.path}`
        );

        // The original file should no longer exist on disk
        try {
            await vscode.workspace.fs.stat(vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' + originalFileName }));
            assert.fail('Original file should not exist after rename');
        } catch {
            // Expected: file not found
        }
    });

    test('kustoTraceTools.renameScratchPad does nothing when cancelled', async () => {
        // Create a scratch pad to attempt to rename
        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, 'Should have an active editor');
        const originalFileName = activeEditor.document.uri.path.replace(/^\//, '');

        // Stub showInputBox to return undefined (user pressed Escape)
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.renameScratchPad', { fileName: originalFileName });
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // The original file should still exist
        const stat = await vscode.workspace.fs.stat(
            vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' + originalFileName })
        );
        assert.ok(stat, 'Original file should still exist after cancelled rename');

        // The active editor should still show the original file
        const editorAfter = vscode.window.activeTextEditor;
        assert.ok(editorAfter, 'Should still have an active editor');
        assert.ok(
            editorAfter.document.uri.path.includes(originalFileName),
            `Active editor should still show original file, got: ${editorAfter.document.uri.path}`
        );
    });

    test('kustoTraceTools.deleteScratchPad does nothing when cancelled', async () => {
        // Create a scratch pad to attempt to delete
        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, 'Should have an active editor');
        const fileName = activeEditor.document.uri.path.replace(/^\//, '');

        // Stub showWarningMessage to return undefined (user cancelled the modal)
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => undefined;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.deleteScratchPad', { fileName });
        } finally {
            (vscode.window as any).showWarningMessage = originalShowWarningMessage;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // The file should still exist
        const stat = await vscode.workspace.fs.stat(
            vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' + fileName })
        );
        assert.ok(stat, 'File should still exist after cancelled delete');

        // The editor should still be open
        const editorAfter = vscode.window.activeTextEditor;
        assert.ok(editorAfter, 'Should still have an active editor');
        assert.ok(
            editorAfter.document.uri.path.includes(fileName),
            `Active editor should still show the file, got: ${editorAfter.document.uri.path}`
        );
    });

    test('Auto-save triggers after editing a scratch pad', async () => {
        // Open ScratchPad1
        const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/ScratchPad1.kql' })
        );
        const editor = await vscode.window.showTextDocument(doc);

        // Type some content
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), 'StormEvents | take 10');
        });

        assert.ok(doc.isDirty, 'Document should be dirty after editing');

        // Wait for auto-save debounce (1s) plus buffer
        await new Promise(resolve => setTimeout(resolve, 2000));

        assert.ok(!doc.isDirty, 'Document should no longer be dirty after auto-save');
    });

    test('Content persists after close and reopen', async () => {
        const testContent = 'StormEvents | count';

        // Write content to ScratchPad1
        const uri = vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/ScratchPad1.kql' });
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(editBuilder => {
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            editBuilder.replace(fullRange, testContent);
        });
        await doc.save();

        // Close the tab
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input as { uri?: vscode.Uri } | undefined;
                if (input?.uri?.toString() === uri.toString()) {
                    await vscode.window.tabGroups.close(tab);
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        // Reopen and verify content
        const reopenedDoc = await vscode.workspace.openTextDocument(uri);
        assert.strictEqual(reopenedDoc.getText(), testContent, 'Content should persist after close and reopen');
    });

    test('kustoTraceTools.deleteScratchPad deletes when confirmed', async () => {
        // Create a scratch pad to delete
        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, 'Should have an active editor');
        const fileName = activeEditor.document.uri.path.replace(/^\//, '');
        const uri = vscode.Uri.from({ scheme: 'kustoTraceTools-scratch', path: '/' + fileName });

        // Stub showWarningMessage to return 'Delete' (user confirmed)
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => 'Delete';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.deleteScratchPad', { fileName });
        } finally {
            (vscode.window as any).showWarningMessage = originalShowWarningMessage;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // The file should no longer exist on disk
        try {
            await vscode.workspace.fs.stat(uri);
            assert.fail('File should not exist after confirmed delete');
        } catch {
            // Expected: file not found
        }

        // The tab should be closed — the deleted file should not be the active editor
        const editorAfter = vscode.window.activeTextEditor;
        if (editorAfter) {
            assert.ok(
                !editorAfter.document.uri.path.includes(fileName),
                `Deleted file should not be the active editor, got: ${editorAfter.document.uri.path}`
            );
        }
    });

    test('New scratch pads get incrementing names', async () => {
        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const editor1 = vscode.window.activeTextEditor;
        assert.ok(editor1, 'Should have an active editor');
        const name1 = editor1.document.uri.path;
        const num1 = parseInt(name1.match(/ScratchPad(\d+)/)?.[1] ?? '0', 10);
        assert.ok(num1 > 0, `Should have a numbered name, got: ${name1}`);

        await vscode.commands.executeCommand('kustoTraceTools.newScratchPad');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const editor2 = vscode.window.activeTextEditor;
        assert.ok(editor2, 'Should have an active editor');
        const name2 = editor2.document.uri.path;
        const num2 = parseInt(name2.match(/ScratchPad(\d+)/)?.[1] ?? '0', 10);
        assert.strictEqual(num2, num1 + 1, `Expected sequential numbering: ${name1} then ${name2}`);
    });
});
