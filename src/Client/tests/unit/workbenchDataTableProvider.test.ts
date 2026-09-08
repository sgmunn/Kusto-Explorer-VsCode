// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { IClipboard } from '../../features/clipboard';
import type {
    IDataTableProvider,
    IDataTableView,
    ResultRowSelection,
} from '../../features/dataTableProvider';
import { NullServer } from '../../features/server';
import type { ResultTable } from '../../features/server';
import type { IWebView } from '../../features/webview';
import { WorkbenchDataTableProvider } from '../../features/workbenchGrid/workbenchDataTableProvider';

describe('WorkbenchDataTableProvider', () => {
    it('routes view creation and row selection through its grid implementation', () => {
        const table: ResultTable = {
            name: 'Results',
            columns: [{ name: 'Value', type: 'string' }],
            rows: [['one']],
        };
        const view = {} as IDataTableView;
        const webview = {} as IWebView;
        const disposable = { dispose: vi.fn() };
        const createView = vi.fn(() => view);
        const onDidSelectRow = vi.fn((_listener: (selection: ResultRowSelection) => void) => disposable);
        const implementation: IDataTableProvider = { createView, onDidSelectRow };
        const clipboard = {} as IClipboard;
        const provider = new WorkbenchDataTableProvider(new NullServer(), clipboard, implementation);
        const listener = vi.fn();

        expect(provider.createView(webview, table)).toBe(view);
        expect(createView).toHaveBeenCalledWith(webview, table, undefined);
        const options = { viewStateName: 'Results::structured' };
        expect(provider.createView(webview, table, undefined, options)).toBe(view);
        expect(createView).toHaveBeenLastCalledWith(webview, table, undefined, options);
        expect(provider.onDidSelectRow(listener)).toBe(disposable);
        expect(onDidSelectRow).toHaveBeenCalledWith(listener);
    });
});
