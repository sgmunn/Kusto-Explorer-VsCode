// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { CancellationToken, ExtensionContext } from 'vscode';
import { Server } from '../../features/server';

function createServer() {
    const sendRequest = vi.fn(async () => null);
    const client = { onRequest: vi.fn(), sendRequest } as unknown as LanguageClient;
    return { server: new Server(client, {} as ExtensionContext), sendRequest };
}

describe('query request transport', () => {
    it('passes the cancellation token outside the JSON-RPC query parameters', async () => {
        const { server, sendRequest } = createServer();
        const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as CancellationToken;
        await server.runQuery('print 1', 'cluster', 'database', true, 10, 'request-id', { name: 'value' }, token);
        expect(sendRequest).toHaveBeenCalledWith('kusto/runQuery', {
            query: 'print 1', cluster: 'cluster', database: 'database', isReadOnly: true,
            maxRows: 10, clientRequestId: 'request-id', parameters: { name: 'value' },
        }, token);
    });

    it('keeps the single-object parameter shape for callers without cancellation', async () => {
        const { server, sendRequest } = createServer();
        await server.runQuery('print 1');
        expect(sendRequest).toHaveBeenCalledWith('kusto/runQuery', {
            query: 'print 1', cluster: undefined, database: undefined, isReadOnly: undefined,
            maxRows: undefined, clientRequestId: undefined, parameters: undefined,
        });
        expect(sendRequest.mock.calls[0]).toHaveLength(2);
    });
});
