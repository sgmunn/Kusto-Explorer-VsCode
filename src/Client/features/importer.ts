// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/*
 * This module implements the Importer class, which handles the UI concerns
 * of importing connections and scratch pads from desktop Kusto Explorer.
 * The actual import logic lives in ImportManager.
 */

import * as vscode from 'vscode';
import { type ConnectionManager } from './connectionManager';
import { ImportManager } from './importManager';

// =============================================================================
// Constants
// =============================================================================

/** Configuration key to suppress the import prompt. */
const SUPPRESS_IMPORT_SETTING = 'connections.suppressKustoExplorerImportPrompt';

// =============================================================================
// Importer Class
// =============================================================================

/**
 * Handles the UI concerns of importing from desktop Kusto Explorer.
 * Registers commands, shows prompts and confirmation dialogs,
 * and displays result messages. Delegates to ImportManager for the actual logic.
 */
export class Importer {
    constructor(
        private readonly importManager: ImportManager,
        private readonly connections: ConnectionManager,
    ) {}

    /**
     * Checks if Kusto Explorer connections exist and the user hasn't dismissed
     * the prompt, then offers to import. Only prompts when the user has no
     * existing connections.
     * @returns true if the user made a definitive choice (Import or Don't Ask Again),
     *          false if they dismissed or no prompt was shown.
     */
    async promptImportIfAvailable(): Promise<boolean> {
        // Only prompt if user has no connections and hasn't suppressed the prompt
        if (vscode.workspace.getConfiguration('kustoTraceTools').get<boolean>(SUPPRESS_IMPORT_SETTING)) {
            return true;
        }

        const existingConnections = this.connections.getConfiguredConnections();
        if (existingConnections.length > 0) {
            return true;
        }

        const hasConnections = this.importManager.hasConnectionsToImport();
        const hasScratchPads = this.importManager.hasScratchPadsToImport();

        if (!hasConnections && !hasScratchPads) {
            return true;
        }

        const what = hasConnections && hasScratchPads ? 'connections and query set documents'
            : hasConnections ? 'connections'
            : 'query set documents';

        const choice = await vscode.window.showInformationMessage(
            `Kusto Explorer ${what} found. Would you like to import them?`,
            { modal: true },
            'Import',
            "Don't Ask Again"
        );

        if (choice === 'Import') {
            if (hasConnections) {
                await this.importConnections(true);
            }
            if (hasScratchPads) {
                await this.importScratchPads(true);
            }
            return true;
        } else if (choice === "Don't Ask Again") {
            await vscode.workspace.getConfiguration('kustoTraceTools').update(SUPPRESS_IMPORT_SETTING, true, vscode.ConfigurationTarget.Global);
            return true;
        }
        // Dismissed (no choice) — caller may re-prompt later
        return false;
    }

    // ─── Import Connections ───────────────────────────────────────────

    /**
     * Import connections entry point with UI prompts and result messages.
     */
    async importConnections(skipConfirm = false): Promise<void> {
        if (!skipConfirm) {
            const confirm = await vscode.window.showInformationMessage(
                'Import connections from Kusto Explorer?',
                { modal: true },
                'Import'
            );
            if (confirm !== 'Import') { return; }
        }

        try {
            const result = await this.importManager.importConnections();

            if (!result) {
                vscode.window.showErrorMessage('No Kusto Explorer installation found.');
                return;
            }

            const { importedCount, skippedCount } = result;

            if (importedCount > 0) {
                const skippedMsg = skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : '';
                vscode.window.showInformationMessage(
                    `Imported ${importedCount} connection${importedCount !== 1 ? 's' : ''} from Kusto Explorer${skippedMsg}.`
                );
            } else if (skippedCount > 0) {
                vscode.window.showInformationMessage(
                    `All ${skippedCount} Kusto Explorer connection${skippedCount !== 1 ? 's' : ''} already exist.`
                );
            } else {
                vscode.window.showInformationMessage('No connections found in Kusto Explorer.');
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to import connections: ${message}`);
        }
    }

    // ─── Import Scratch Pads ────────────────────────────────────────────

    /**
     * Import scratch pads entry point with UI prompts and result messages.
     */
    async importScratchPads(skipConfirm = false): Promise<void> {
        if (!this.importManager.hasScratchPadsToImport()) {
            vscode.window.showInformationMessage('No Kusto Explorer scratch pad documents found to import.');
            return;
        }

        const scratchPadCount = this.importManager.getScratchPadsToImportCount();

        if (!skipConfirm) {
            const confirm = await vscode.window.showInformationMessage(
                `Import ${scratchPadCount} scratch pad document${scratchPadCount !== 1 ? 's' : ''} from Kusto Explorer?`,
                { modal: true },
                'Import'
            );
            if (confirm !== 'Import') { return; }
        }

        const importResult = await this.importManager.importScratchPads();

        if (importResult && importResult.importedCount > 0) {
            vscode.window.showInformationMessage(
                `Imported ${importResult.importedCount} scratch pad document${importResult.importedCount !== 1 ? 's' : ''} from Kusto Explorer.`
            );
        }
    }
}
