// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { DataTableProvider } from '../dataTableProvider';
import type {
    IDataTableProvider,
    IDataTableView,
    IDataTableWebviewContribution,
    ResultRowSelection,
} from '../dataTableProvider';
import type { IClipboard } from '../clipboard';
import type { IServer, ResultTable, ResultTableView } from '../server';
import type { IWebView } from '../webview';
import { createColumnFilterContribution } from './columnFilters';
import { createLoadingOverlayContribution } from './loadingOverlay';
import { createSeverityHighlightingContribution } from './severityHighlighting';

function createWorkbenchGridContribution(): IDataTableWebviewContribution {
    const columnFilters = createColumnFilterContribution();
    const loadingOverlay = createLoadingOverlayContribution();
    const severityHighlighting = createSeverityHighlightingContribution();
    return {
        headHtml:
            (columnFilters.headHtml ?? '') +
            (loadingOverlay.headHtml ?? '') +
            (severityHighlighting.headHtml ?? ''),
        beforeCreateScript:
            (columnFilters.beforeCreateScript ?? '') +
            (loadingOverlay.beforeCreateScript ?? '') +
            (severityHighlighting.beforeCreateScript ?? ''),
        ...(loadingOverlay.yieldBeforeCreateAtRowCount !== undefined && {
            yieldBeforeCreateAtRowCount: loadingOverlay.yieldBeforeCreateAtRowCount,
        }),
        afterCreateScript:
            (columnFilters.afterCreateScript ?? '') + (loadingOverlay.afterCreateScript ?? ''),
    };
}

/**
 * Fork-owned boundary for results-grid development.
 *
 * ResultsViewer depends only on IDataTableProvider, so both live query results
 * and .kqr documents flow through this class. During the parity phase it
 * delegates to the upstream grid. The delegate can be replaced incrementally
 * without changing result orchestration or its callers.
 */
export class WorkbenchDataTableProvider implements IDataTableProvider {
    private readonly implementation: IDataTableProvider;

    constructor(server: IServer, clipboard: IClipboard, implementation?: IDataTableProvider) {
        this.implementation = implementation ?? new DataTableProvider(server, clipboard, createWorkbenchGridContribution);
    }

    createView(webview: IWebView, table: ResultTable, view?: ResultTableView): IDataTableView {
        return this.implementation.createView(webview, table, view);
    }

    onDidSelectRow(listener: (selection: ResultRowSelection) => void): { dispose(): void } {
        return this.implementation.onDidSelectRow(listener);
    }
}
