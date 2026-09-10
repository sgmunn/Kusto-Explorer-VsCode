// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { CancellationToken } from 'vscode';
import { runCancellableQuery } from '../../features/queryCancellation';

function cancellationSource() {
    const listeners = new Set<() => void>();
    const token: CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested(listener) {
            listeners.add(listener);
            return { dispose: () => { listeners.delete(listener); } };
        },
    };
    return {
        token,
        listeners,
        cancel() {
            token.isCancellationRequested = true;
            for (const listener of listeners) { listener(); }
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('query cancellation', () => {
    it('does not start a request that was already cancelled', async () => {
        const source = cancellationSource();
        source.cancel();
        const request = vi.fn(() => Promise.resolve('result'));
        expect(await runCancellableQuery(source.token, request)).toBeUndefined();
        expect(request).not.toHaveBeenCalled();
        expect(source.listeners.size).toBe(0);
    });

    it('finishes a cancelled run promptly without cancelling a concurrent run', async () => {
        const firstSource = cancellationSource();
        const secondSource = cancellationSource();
        const firstRequest = deferred<string>();
        const secondRequest = deferred<string>();
        const first = runCancellableQuery(firstSource.token, () => firstRequest.promise);
        const second = runCancellableQuery(secondSource.token, () => secondRequest.promise);
        firstSource.cancel();
        expect(await first).toBeUndefined();
        expect(firstSource.listeners.size).toBe(0);
        expect(secondSource.token.isCancellationRequested).toBe(false);
        secondRequest.resolve('surviving result');
        expect(await second).toBe('surviving result');
        expect(secondSource.listeners.size).toBe(0);
        firstRequest.resolve('ignored result');
        expect(await first).toBeUndefined();
    });

    it('handles a late failure after cancellation without reporting an unhandled rejection', async () => {
        const source = cancellationSource();
        const request = deferred<string>();
        const result = runCancellableQuery(source.token, () => request.promise);
        source.cancel();
        expect(await result).toBeUndefined();
        request.reject(new Error('server cancelled'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(source.listeners.size).toBe(0);
    });

    it('preserves execution errors and releases its subscription', async () => {
        const source = cancellationSource();
        const failure = new Error('query failed');
        await expect(runCancellableQuery(source.token, () => Promise.reject(failure))).rejects.toBe(failure);
        expect(source.listeners.size).toBe(0);
    });

    it('releases the subscription when the request throws synchronously', async () => {
        const source = cancellationSource();
        await expect(runCancellableQuery(source.token, () => { throw new Error('failed to start'); })).rejects.toThrow('failed to start');
        expect(source.listeners.size).toBe(0);
    });
});
