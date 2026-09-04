// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IDataTableWebviewContribution } from '../dataTableProvider';

export const LARGE_RESULT_LOADING_THRESHOLD = 1000;

const headHtml = `<style>
    .workbench-grid-is-loading { position: relative; }
    .workbench-grid-loading-overlay {
        position: absolute;
        inset: 0;
        z-index: 1001;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-descriptionForeground, var(--vscode-foreground));
        background: var(--vscode-editor-background);
        opacity: .88;
        cursor: progress;
        pointer-events: all;
        transition: opacity 140ms ease-out;
    }
    .workbench-grid-loading-overlay.leaving { opacity: 0; }
    .workbench-grid-loading-status {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 7px 11px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
        border-radius: 4px;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, .18));
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
    }
    .workbench-grid-loading-spinner {
        width: 14px;
        height: 14px;
        box-sizing: border-box;
        border: 2px solid var(--vscode-progressBar-background, #0e70c0);
        border-right-color: transparent;
        border-radius: 50%;
        animation: workbench-grid-spin 750ms linear infinite;
    }
    @keyframes workbench-grid-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
        .workbench-grid-loading-spinner { animation: none; }
    }
</style>`;

/** Adds a blocking progress treatment while a large result grid is initialized. */
export function createLoadingOverlayContribution(
    thresholdRows = LARGE_RESULT_LOADING_THRESHOLD,
): IDataTableWebviewContribution {
    return {
        headHtml,
        yieldBeforeCreateAtRowCount: thresholdRows,
        beforeCreateScript: `
    var workbenchLoadingOverlay = null;
    if (tableData.rows.length >= ${thresholdRows}) {
        container.classList.add('workbench-grid-is-loading');
        container.setAttribute('aria-busy', 'true');
        workbenchLoadingOverlay = document.createElement('div');
        workbenchLoadingOverlay.className = 'workbench-grid-loading-overlay';
        workbenchLoadingOverlay.setAttribute('role', 'status');
        workbenchLoadingOverlay.setAttribute('aria-live', 'polite');

        var workbenchLoadingStatus = document.createElement('div');
        workbenchLoadingStatus.className = 'workbench-grid-loading-status';
        var workbenchLoadingSpinner = document.createElement('span');
        workbenchLoadingSpinner.className = 'workbench-grid-loading-spinner';
        workbenchLoadingSpinner.setAttribute('aria-hidden', 'true');
        var workbenchLoadingLabel = document.createElement('span');
        workbenchLoadingLabel.textContent = 'Rendering ' +
            tableData.rows.length.toLocaleString() + ' rows…';
        workbenchLoadingStatus.appendChild(workbenchLoadingSpinner);
        workbenchLoadingStatus.appendChild(workbenchLoadingLabel);
        workbenchLoadingOverlay.appendChild(workbenchLoadingStatus);
        container.appendChild(workbenchLoadingOverlay);
    }`,
        afterCreateScript: `
    function workbenchRemoveLoadingOverlay() {
        container.classList.remove('workbench-grid-is-loading');
        container.removeAttribute('aria-busy');
        if (workbenchLoadingOverlay && workbenchLoadingOverlay.parentNode) {
            workbenchLoadingOverlay.parentNode.removeChild(workbenchLoadingOverlay);
        }
        workbenchLoadingOverlay = null;
    }
    if (workbenchLoadingOverlay) {
        requestAnimationFrame(function() {
            workbenchLoadingOverlay.classList.add('leaving');
            setTimeout(workbenchRemoveLoadingOverlay, 150);
        });
    }
    var workbenchPreviousCleanup = contributionCleanup;
    contributionCleanup = function() {
        workbenchRemoveLoadingOverlay();
        if (typeof workbenchPreviousCleanup === 'function') workbenchPreviousCleanup();
    };`,
    };
}
