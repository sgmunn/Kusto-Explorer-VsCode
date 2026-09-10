// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { CancellationToken } from 'vscode';

/** Finish promptly on cancellation and ignore responses from a server still winding down. */
export async function runCancellableQuery<T>(token: CancellationToken, request: () => Promise<T>): Promise<T | undefined> {
    if (token.isCancellationRequested) { return undefined; }

    let subscription: { dispose(): void } | undefined;
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            subscription = token.onCancellationRequested(() => resolve(undefined));
            if (token.isCancellationRequested) {
                resolve(undefined);
                return;
            }
            // Both handlers remain attached if cancellation wins, including for late failures.
            Promise.resolve(request()).then(resolve, reject);
        });
    } finally {
        subscription?.dispose();
    }
}
