// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import {
    formatExceptionCallstack,
    formatExceptionJson,
    RowDetailsView,
} from '../../features/rowDetailsView';
import type { ResultRowSelection } from '../../features/dataTableProvider';
import type { ResultTable } from '../../features/server';

describe('exception details formatting', () => {
    it('separates compact frames, removes framework noise, and simplifies generated methods', () => {
        const callstack = [
            'at Contoso.Service.Handler.<HandleAsync>d__12.MoveNext()',
            'at System.Runtime.CompilerServices.AsyncTaskMethodBuilder.Start()',
            'at Contoso.Service.Program.Main()',
            'at System.Net.Http.HttpClient.SendAsync()',
            'at Polly.Retry.AsyncRetryEngine.ImplementationAsync()',
        ].join(' ');

        expect(formatExceptionCallstack(callstack)).toBe([
            'at Contoso.Service.Handler.HandleAsync()',
            'at Contoso.Service.Program.Main()',
        ].join('\n'));
    });

    it('formats callstack properties at any depth without changing other JSON values', () => {
        expect(formatExceptionJson({
            Message: 'failed',
            exception: { callstack: 'at App.Work() at System.IO.File.ReadAllText()' },
        })).toEqual({
            Message: 'failed',
            exception: { callstack: 'at App.Work()' },
        });
    });

    it('keeps source locations readable without the full build path', () => {
        expect(formatExceptionCallstack(
            'at Contoso.Work() in D:\\a\\_work\\1\\s\\Core\\Microsoft.Dms.Platform\\Utilities\\DmsPbiServiceExceptionUtilities.cs :line 114\\nat Contoso.Next()'
        )).toBe('at Contoso.Work() in DmsPbiServiceExceptionUtilities.cs:line 114 at Contoso.Next()');
    });

    it('retains and simplifies compiler-generated callback frames from inner exceptions', () => {
        expect(formatExceptionCallstack(
            't+<>c__DisplayClass21_0.<LoadIntoBufferAsync>b__0(Task copyTask) \\r\\n at System.Threading.Tasks.Task.Execute()'
        )).toBe('t.LoadIntoBufferAsync()');
    });

    it('keeps framework frames when they are the only available stack detail', () => {
        expect(formatExceptionCallstack('at System.Net.Http.HttpClient.SendAsync()'))
            .toBe('at System.Net.Http.HttpClient.SendAsync()');
    });

    it('filters framework frames even when they followed an application source location', () => {
        expect(formatExceptionCallstack(
            'at App.Exception..ctor() in Exception.cs:line 43 at App.Handler.<HandleAsync>d__3.MoveNext() in Handler.cs:line 132 at System.Threading.ExecutionContext.RunInternal()'
        )).toBe('at App.Exception..ctor() in Exception.cs:line 43 at App.Handler.HandleAsync() in Handler.cs:line 132');
    });
});

describe('RowDetailsView selection rendering', () => {
    it('does not rebuild the webview for an identical row selection', () => {
        const htmlWrites: string[] = [];
        const webview = {
            options: {},
            get html() { return htmlWrites.at(-1) ?? ''; },
            set html(value: string) { htmlWrites.push(value); },
            onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const webviewView = {
            webview,
            onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const details = new RowDetailsView();
        const table: ResultTable = {
            name: 'Results',
            columns: [{ name: 'Value', type: 'string' }],
            rows: [['one'], ['two']],
        };
        const first: ResultRowSelection = { table, rowIndexes: [0] };

        details.resolveWebviewView(webviewView as never);
        details.show(first);
        const writesAfterFirstSelection = htmlWrites.length;
        details.show({ table, rowIndexes: [0] });

        expect(htmlWrites).toHaveLength(writesAfterFirstSelection);
        details.show({ table, rowIndexes: [1] });
        expect(htmlWrites).toHaveLength(writesAfterFirstSelection + 1);
    });
});
