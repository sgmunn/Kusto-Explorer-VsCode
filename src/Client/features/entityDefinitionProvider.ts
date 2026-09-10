// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/*
 * This module provides "Go to Definition" for Kusto database entities (tables, functions, etc.).
 * When the language server resolves a definition to a kustotracetools-entity:// URI, this provider fetches
 * the entity's create command from the server and displays it as a read-only virtual document.
 */

import * as vscode from 'vscode';
import type { IServer } from './server';

/**
 * URI scheme for virtual entity definition documents.
 * Must match the scheme used in the language server (KustoLspServer.cs).
 */
export const ENTITY_DEFINITION_SCHEME = 'kustotracetools-entity';

/**
 * Provides content for virtual entity definition documents.
 * 
 * When the user performs "Go to Definition" on a database entity (table, function, etc.),
 * the language server returns a URI with the 'kustotracetools-entity' scheme. VS Code then calls
 * this provider to get the document content, which displays the entity's create command.
 * 
 * This mimics Visual Studio's "metadata as source" feature for decompiled types.
 */
export class EntityDefinitionProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly server: IServer) {}

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        try {
            const result = await this.server.getEntityDefinitionContent(uri.toString(), token);

            if (result?.content) {
                return result.content;
            }
        } catch (error) {
            console.error('Failed to get entity definition content:', error);
        }

        return '// Unable to retrieve entity definition';
    }

    /**
     * Invalidates the cached content for a URI, causing VS Code to request fresh content.
     * Call this if you know the entity definition has changed on the server.
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
