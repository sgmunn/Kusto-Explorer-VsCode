// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect, vi } from 'vitest';
import { EntityDefinitionProvider, ENTITY_DEFINITION_SCHEME } from '../../features/entityDefinitionProvider';
import type { Server } from '../../features/server';
import type * as vscode from 'vscode';

function createMockServer(content?: string | null, shouldThrow?: boolean): Server {
    return {
        getEntityDefinitionContent: shouldThrow
            ? vi.fn(async () => { throw new Error('server error'); })
            : vi.fn(async () => content !== undefined ? (content === null ? null : { content }) : null),
    } as unknown as Server;
}

function mockUri(value: string): vscode.Uri {
    return { toString: () => value, path: value } as unknown as vscode.Uri;
}

const mockToken = { isCancellationRequested: false } as vscode.CancellationToken;

describe('EntityDefinitionProvider', () => {
    describe('ENTITY_DEFINITION_SCHEME', () => {
        it('equals kustotracetools-entity', () => {
            expect(ENTITY_DEFINITION_SCHEME).toBe('kustotracetools-entity');
        });
    });

    describe('provideTextDocumentContent', () => {
        it('returns content from the server', async () => {
            const server = createMockServer('.create table StormEvents (StartTime: datetime)');
            const provider = new EntityDefinitionProvider(server);

            const result = await provider.provideTextDocumentContent(
                mockUri('kustotracetools-entity://help/Samples/StormEvents'),
                mockToken,
            );

            expect(result).toBe('.create table StormEvents (StartTime: datetime)');
        });

        it('passes the URI string to the server', async () => {
            const server = createMockServer('content');
            const provider = new EntityDefinitionProvider(server);

            await provider.provideTextDocumentContent(
                mockUri('kustotracetools-entity://cluster/db/entity'),
                mockToken,
            );

            expect(server.getEntityDefinitionContent).toHaveBeenCalledWith(
                'kustotracetools-entity://cluster/db/entity',
                mockToken,
            );
        });

        it('returns fallback message when server returns null', async () => {
            const server = createMockServer(null);
            const provider = new EntityDefinitionProvider(server);

            const result = await provider.provideTextDocumentContent(mockUri('uri'), mockToken);

            expect(result).toBe('// Unable to retrieve entity definition');
        });

        it('returns fallback message when server throws', async () => {
            const server = createMockServer(undefined, true);
            const provider = new EntityDefinitionProvider(server);

            const result = await provider.provideTextDocumentContent(mockUri('uri'), mockToken);

            expect(result).toBe('// Unable to retrieve entity definition');
        });
    });

    describe('refresh', () => {
        it('fires onDidChange event with the URI', () => {
            const server = createMockServer('content');
            const provider = new EntityDefinitionProvider(server);

            let firedUri: vscode.Uri | undefined;
            provider.onDidChange((uri) => { firedUri = uri; });

            const uri = mockUri('kustotracetools-entity://test');
            provider.refresh(uri);

            expect(firedUri).toBe(uri);
        });
    });
});
