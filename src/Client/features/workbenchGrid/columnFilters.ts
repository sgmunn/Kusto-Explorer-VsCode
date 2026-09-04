// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IDataTableWebviewContribution } from '../dataTableProvider';

export type ColumnFilterOperator =
    | 'contains'
    | 'notContains'
    | 'equals'
    | 'notEquals'
    | 'startsWith'
    | 'greaterThan'
    | 'greaterThanOrEqual'
    | 'lessThan'
    | 'lessThanOrEqual'
    | 'isEmpty'
    | 'isNotEmpty'
    | 'isTrue'
    | 'isFalse';

export interface ColumnFilterCondition {
    operator: ColumnFilterOperator;
    value?: string;
}

export interface ColumnFilter {
    columnIndex: number;
    type: string;
    join: 'and' | 'or';
    conditions: ColumnFilterCondition[];
}

export interface ColumnFilterOperatorOption {
    value: ColumnFilterOperator;
    label: string;
    requiresValue: boolean;
}

export function operatorsForKustoType(type: string): ColumnFilterOperatorOption[] {
    const normalized = type.toLowerCase();
    const noValue: ColumnFilterOperatorOption[] = [
        { value: 'isEmpty', label: 'Is empty', requiresValue: false },
        { value: 'isNotEmpty', label: 'Is not empty', requiresValue: false },
    ];
    if (normalized === 'bool' || normalized === 'boolean') {
        return [
            { value: 'isTrue', label: 'Is true', requiresValue: false },
            { value: 'isFalse', label: 'Is false', requiresValue: false },
            ...noValue,
        ];
    }
    if (['int', 'long', 'real', 'decimal', 'timespan'].includes(normalized)) {
        return [
            { value: 'equals', label: 'Equals', requiresValue: true },
            { value: 'notEquals', label: 'Does not equal', requiresValue: true },
            { value: 'greaterThan', label: 'Greater than', requiresValue: true },
            { value: 'greaterThanOrEqual', label: 'Greater than or equal', requiresValue: true },
            { value: 'lessThan', label: 'Less than', requiresValue: true },
            { value: 'lessThanOrEqual', label: 'Less than or equal', requiresValue: true },
            ...noValue,
        ];
    }
    if (normalized === 'datetime' || normalized === 'date') {
        return [
            { value: 'equals', label: 'On', requiresValue: true },
            { value: 'notEquals', label: 'Not on', requiresValue: true },
            { value: 'greaterThan', label: 'After', requiresValue: true },
            { value: 'greaterThanOrEqual', label: 'On or after', requiresValue: true },
            { value: 'lessThan', label: 'Before', requiresValue: true },
            { value: 'lessThanOrEqual', label: 'On or before', requiresValue: true },
            ...noValue,
        ];
    }
    return [
        { value: 'contains', label: 'Contains', requiresValue: true },
        { value: 'notContains', label: 'Does not contain', requiresValue: true },
        { value: 'equals', label: 'Equals', requiresValue: true },
        { value: 'notEquals', label: 'Does not equal', requiresValue: true },
        { value: 'startsWith', label: 'Starts with', requiresValue: true },
        ...noValue,
    ];
}

/** Evaluates one cell against a typed client-side column filter. */
export function matchesColumnFilter(value: unknown, filter: ColumnFilter): boolean {
    let raw: unknown = value;
    if (raw && typeof raw === 'object') {
        const cell = raw as { text?: unknown; data?: unknown };
        raw = cell.text ?? cell.data ?? raw;
    }
    if (raw !== null && raw !== undefined && typeof raw === 'object') {
        try { raw = JSON.stringify(raw); } catch { raw = String(raw); }
    }
    const text = raw === null || raw === undefined ? '' : String(raw);
    const folded = text.toLocaleLowerCase();
    const normalizedType = String(filter.type || '').toLowerCase();

    const parseTimespan = (candidate: string): number => {
        const match = candidate.trim().match(/^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
        if (!match) return Number.NaN;
        const sign = match[1] ? -1 : 1;
        const days = Number(match[2] || 0);
        const hours = Number(match[3]);
        const minutes = Number(match[4]);
        const seconds = Number(match[5]);
        return sign * ((((days * 24) + hours) * 60 + minutes) * 60 + seconds);
    };

    const evaluate = (condition: ColumnFilterCondition): boolean => {
        const expectedText = condition.value ?? '';
        const expectedFolded = expectedText.toLocaleLowerCase();
        switch (condition.operator) {
            case 'isEmpty': return text.length === 0;
            case 'isNotEmpty': return text.length > 0;
            case 'isTrue': return folded === 'true' || folded === '1';
            case 'isFalse': return folded === 'false' || folded === '0';
            case 'contains': return folded.includes(expectedFolded);
            case 'notContains': return !folded.includes(expectedFolded);
            case 'startsWith': return folded.startsWith(expectedFolded);
        }

        let actual: string | number = folded;
        let expected: string | number = expectedFolded;
        if (['int', 'long', 'real', 'decimal'].includes(normalizedType)) {
            const actualNumber = Number(text);
            const expectedNumber = Number(expectedText);
            if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) return false;
            actual = actualNumber;
            expected = expectedNumber;
        } else if (normalizedType === 'timespan') {
            const actualTimespan = parseTimespan(text);
            const expectedTimespan = parseTimespan(expectedText);
            if (Number.isNaN(actualTimespan) || Number.isNaN(expectedTimespan)) return false;
            actual = actualTimespan;
            expected = expectedTimespan;
        } else if (normalizedType === 'datetime' || normalizedType === 'date') {
            const actualDate = Date.parse(text);
            const expectedDate = Date.parse(expectedText);
            if (Number.isNaN(actualDate) || Number.isNaN(expectedDate)) return false;
            actual = actualDate;
            expected = expectedDate;
        }

        switch (condition.operator) {
            case 'equals': return actual === expected;
            case 'notEquals': return actual !== expected;
            case 'greaterThan': return actual > expected;
            case 'greaterThanOrEqual': return actual >= expected;
            case 'lessThan': return actual < expected;
            case 'lessThanOrEqual': return actual <= expected;
            default: return true;
        }
    };

    const results = filter.conditions.map(evaluate);
    return filter.join === 'or' ? results.some(Boolean) : results.every(Boolean);
}

const headHtml = `<style>
    .datatable-table thead th[data-col] { padding-right: 34px; }
    .workbench-filter-button {
        position: absolute;
        right: 17px;
        top: 50%;
        transform: translateY(-50%);
        width: 18px;
        height: 18px;
        padding: 1px;
        border: 0;
        border-radius: 3px;
        color: var(--vscode-descriptionForeground, currentColor);
        background: transparent;
        cursor: pointer;
        z-index: 3;
    }
    .workbench-filter-button:hover,
    .workbench-filter-button.active {
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
    }
    .workbench-filter-button svg { display: block; width: 14px; height: 14px; }
    .workbench-filter-popover {
        position: fixed;
        z-index: 1000;
        width: 310px;
        padding: 10px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #555));
        border-radius: 4px;
        color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, .35));
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
    }
    .workbench-filter-title { margin-bottom: 8px; font-weight: 600; }
    .workbench-filter-condition { display: grid; grid-template-columns: 1fr 1.25fr; gap: 6px; margin-top: 6px; }
    .workbench-filter-popover select,
    .workbench-filter-popover input {
        min-width: 0;
        box-sizing: border-box;
        padding: 4px 6px;
        border: 1px solid var(--vscode-input-border, #555);
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        background: var(--vscode-input-background, var(--vscode-editor-background));
        font: inherit;
    }
    .workbench-filter-popover input.hidden { visibility: hidden; }
    .workbench-filter-join { margin-top: 8px; }
    .workbench-filter-actions { display: flex; gap: 6px; margin-top: 10px; }
    .workbench-filter-actions button {
        padding: 3px 8px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 2px;
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
        cursor: pointer;
        font: inherit;
    }
    .workbench-filter-actions button.secondary {
        color: var(--vscode-foreground);
        background: var(--vscode-button-secondaryBackground, transparent);
    }
    .workbench-clear-filters {
        display: none;
        margin-right: 8px;
        padding: 3px 8px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 2px;
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        background: var(--vscode-button-secondaryBackground, transparent);
        cursor: pointer;
        font: inherit;
    }
    .workbench-clear-filters.visible { display: inline-block; }
</style>`;

export function createColumnFilterContribution(): IDataTableWebviewContribution {
    const matcherSource = matchesColumnFilter.toString();
    const operatorsSource = operatorsForKustoType.toString();
    return {
        headHtml,
        beforeCreateScript: `
    var workbenchColumnFilters = {};
    var workbenchFilterTerm = 'kefiltertoken9f4c2a7b';
    var workbenchMatchesColumnFilter = ${matcherSource};
    var workbenchOperatorsForKustoType = ${operatorsSource};
    columnSettings.slice(1).forEach(function(setting) {
        setting.searchMethod = function(terms, cell, _row, columnIndex) {
            if ((terms || []).indexOf(workbenchFilterTerm) >= 0) {
                var filter = workbenchColumnFilters[columnIndex - 1];
                return !!filter && workbenchMatchesColumnFilter(cell, filter);
            }
            var raw = cell && typeof cell === 'object' ? (cell.text ?? cell.data ?? '') : cell;
            var haystack = String(raw ?? '').toLocaleLowerCase();
            return !terms || terms.length === 0 || terms.some(function(term) {
                return haystack.indexOf(String(term).toLocaleLowerCase()) >= 0;
            });
        };
    });`,
        afterCreateScript: `
    var workbenchFilterPopover = null;
    var workbenchFilterTimer = null;
    var workbenchGlobalSearchTimer = null;
    var workbenchClearAllButton = null;
    var workbenchFunnelSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12l-4.7 5.2v3.6l-2.6 1.4v-5z"/></svg>';

    function workbenchCloseFilter() {
        if (workbenchFilterPopover && workbenchFilterPopover.parentNode) {
            workbenchFilterPopover.parentNode.removeChild(workbenchFilterPopover);
        }
        workbenchFilterPopover = null;
    }

    function workbenchRefreshFilterButtons() {
        var headers = tableEl.querySelectorAll('thead th[data-col]');
        for (var i = 0; i < headers.length; i++) {
            var th = headers[i];
            var originalIndex = parseInt(th.dataset.col, 10);
            if (isNaN(originalIndex)) continue;
            var button = th.querySelector('.workbench-filter-button');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'workbench-filter-button';
                button.innerHTML = workbenchFunnelSvg;
                button.title = 'Filter ' + tableData.columns[originalIndex].name;
                button.setAttribute('aria-label', button.title);
                button.dataset.col = String(originalIndex);
                button.addEventListener('mousedown', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                });
                button.addEventListener('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    workbenchOpenFilter(parseInt(event.currentTarget.dataset.col, 10), event.currentTarget);
                });
                th.appendChild(button);
            }
            var active = !!workbenchColumnFilters[originalIndex];
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
        if (workbenchClearAllButton) {
            workbenchClearAllButton.classList.toggle(
                'visible',
                Object.keys(workbenchColumnFilters).length > 0
            );
        }
    }

    function workbenchApplyFilters() {
        var queries = [];
        var globalInput = container.querySelector('.datatable-search .datatable-input');
        var globalText = globalInput ? globalInput.value.trim() : '';
        if (globalText) {
            queries.push({ terms: globalText.split(/\\s+/) });
        }
        Object.keys(workbenchColumnFilters).forEach(function(key) {
            var filter = workbenchColumnFilters[key];
            queries.push({
                // The term merely activates this column's custom matcher.
                // Filter state stays in memory so Simple-DataTables cannot
                // corrupt it while normalizing search punctuation and case.
                terms: [workbenchFilterTerm],
                columns: [filter.columnIndex + 1]
            });
        });
        grid.multiSearch(queries);
        workbenchRefreshFilterButtons();
    }

    function workbenchScheduleFilters() {
        if (workbenchFilterTimer) clearTimeout(workbenchFilterTimer);
        workbenchFilterTimer = setTimeout(workbenchApplyFilters, 150);
    }

    function workbenchOpenFilter(originalIndex, anchor) {
        if (isNaN(originalIndex)) return;
        workbenchCloseFilter();
        var column = tableData.columns[originalIndex];
        var options = workbenchOperatorsForKustoType(column.type);
        var existing = workbenchColumnFilters[originalIndex];
        var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
            columnIndex: originalIndex,
            type: column.type,
            join: 'and',
            conditions: [{ operator: options[0].value, value: '' }]
        };

        var popover = document.createElement('div');
        popover.className = 'workbench-filter-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Filter ' + column.name);
        popover.addEventListener('mousedown', function(event) { event.stopPropagation(); });
        popover.addEventListener('click', function(event) { event.stopPropagation(); });
        workbenchFilterPopover = popover;
        document.body.appendChild(popover);

        function commitDraft() {
            var usable = draft.conditions.filter(function(condition) {
                var option = options.find(function(candidate) { return candidate.value === condition.operator; });
                return option && (!option.requiresValue || String(condition.value || '').length > 0);
            });
            if (usable.length) {
                workbenchColumnFilters[originalIndex] = {
                    columnIndex: originalIndex,
                    type: column.type,
                    join: draft.join,
                    conditions: usable
                };
            } else {
                delete workbenchColumnFilters[originalIndex];
            }
            workbenchScheduleFilters();
        }

        function renderEditor() {
            popover.replaceChildren();
            var title = document.createElement('div');
            title.className = 'workbench-filter-title';
            title.textContent = 'Filter ' + column.name;
            popover.appendChild(title);

            if (draft.conditions.length > 1) {
                var join = document.createElement('select');
                join.className = 'workbench-filter-join';
                [['and', 'Match all conditions'], ['or', 'Match any condition']].forEach(function(entry) {
                    var option = document.createElement('option');
                    option.value = entry[0];
                    option.textContent = entry[1];
                    option.selected = draft.join === entry[0];
                    join.appendChild(option);
                });
                join.addEventListener('change', function() { draft.join = join.value; commitDraft(); });
                popover.appendChild(join);
            }

            draft.conditions.forEach(function(condition, conditionIndex) {
                var row = document.createElement('div');
                row.className = 'workbench-filter-condition';
                var operator = document.createElement('select');
                options.forEach(function(candidate) {
                    var option = document.createElement('option');
                    option.value = candidate.value;
                    option.textContent = candidate.label;
                    option.selected = candidate.value === condition.operator;
                    operator.appendChild(option);
                });
                var input = document.createElement('input');
                input.type = 'text';
                input.value = condition.value || '';
                if (column.type === 'datetime') input.placeholder = 'ISO date/time';
                if (column.type === 'timespan') input.placeholder = 'd.hh:mm:ss';
                var selected = options.find(function(candidate) { return candidate.value === condition.operator; });
                input.classList.toggle('hidden', !!selected && !selected.requiresValue);
                operator.addEventListener('change', function() {
                    condition.operator = operator.value;
                    renderEditor();
                    commitDraft();
                });
                input.addEventListener('input', function() {
                    condition.value = input.value;
                    commitDraft();
                });
                row.appendChild(operator);
                row.appendChild(input);
                popover.appendChild(row);
                if (conditionIndex === 0 && draft.conditions.length > 1) input.placeholder = 'First value';
            });

            var actions = document.createElement('div');
            actions.className = 'workbench-filter-actions';
            if (draft.conditions.length < 2) {
                var add = document.createElement('button');
                add.type = 'button';
                add.className = 'secondary';
                add.textContent = 'Add condition';
                add.addEventListener('click', function() {
                    draft.conditions.push({ operator: options[0].value, value: '' });
                    renderEditor();
                });
                actions.appendChild(add);
            }
            if (draft.conditions.length > 1) {
                var remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'secondary';
                remove.textContent = 'Remove condition';
                remove.addEventListener('click', function() {
                    draft.conditions.pop();
                    renderEditor();
                    commitDraft();
                });
                actions.appendChild(remove);
            }
            var clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'secondary';
            clear.textContent = 'Clear';
            clear.addEventListener('click', function() {
                delete workbenchColumnFilters[originalIndex];
                workbenchScheduleFilters();
                workbenchCloseFilter();
            });
            actions.appendChild(clear);
            popover.appendChild(actions);

            var rect = anchor.getBoundingClientRect();
            var left = Math.min(rect.left, Math.max(8, window.innerWidth - 326));
            var top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - popover.offsetHeight - 8));
            popover.style.left = left + 'px';
            popover.style.top = top + 'px';
        }

        renderEditor();
        var firstInput = popover.querySelector('input:not(.hidden)');
        if (firstInput) firstInput.focus();
    }

    function workbenchAfterGridRedraw() {
        try { requestAnimationFrame(workbenchRefreshFilterButtons); }
        catch (_) { setTimeout(workbenchRefreshFilterButtons, 0); }
    }
    grid.on('datatable.update', workbenchAfterGridRedraw);
    grid.on('datatable.page', workbenchAfterGridRedraw);
    grid.on('datatable.search', workbenchAfterGridRedraw);
    grid.on('datatable.multisearch', workbenchAfterGridRedraw);
    grid.on('datatable.refresh', workbenchAfterGridRedraw);

    function workbenchOnContainerInput(event) {
        if (!event.target.matches || !event.target.matches('.datatable-search .datatable-input')) return;
        if (workbenchGlobalSearchTimer) clearTimeout(workbenchGlobalSearchTimer);
        workbenchGlobalSearchTimer = setTimeout(function() {
            if (Object.keys(workbenchColumnFilters).length) workbenchApplyFilters();
        }, 0);
    }
    function workbenchOnDocumentMouseDown(event) {
        if (workbenchFilterPopover && !workbenchFilterPopover.contains(event.target)) workbenchCloseFilter();
    }
    function workbenchOnDocumentKeyDown(event) {
        if (event.key === 'Escape') workbenchCloseFilter();
    }
    container.addEventListener('input', workbenchOnContainerInput);
    document.addEventListener('mousedown', workbenchOnDocumentMouseDown);
    document.addEventListener('keydown', workbenchOnDocumentKeyDown);
    var workbenchTop = container.querySelector('.datatable-top');
    if (workbenchTop) {
        workbenchClearAllButton = document.createElement('button');
        workbenchClearAllButton.type = 'button';
        workbenchClearAllButton.className = 'workbench-clear-filters';
        workbenchClearAllButton.textContent = 'Clear all filters';
        workbenchClearAllButton.addEventListener('click', function() {
            workbenchColumnFilters = {};
            workbenchCloseFilter();
            workbenchApplyFilters();
        });
        workbenchTop.insertBefore(workbenchClearAllButton, workbenchTop.firstChild);
    }
    try { requestAnimationFrame(workbenchRefreshFilterButtons); }
    catch (_) { setTimeout(workbenchRefreshFilterButtons, 0); }

    contributionCleanup = function() {
        if (workbenchFilterTimer) clearTimeout(workbenchFilterTimer);
        if (workbenchGlobalSearchTimer) clearTimeout(workbenchGlobalSearchTimer);
        container.removeEventListener('input', workbenchOnContainerInput);
        document.removeEventListener('mousedown', workbenchOnDocumentMouseDown);
        document.removeEventListener('keydown', workbenchOnDocumentKeyDown);
        if (workbenchClearAllButton && workbenchClearAllButton.parentNode) {
            workbenchClearAllButton.parentNode.removeChild(workbenchClearAllButton);
        }
        workbenchCloseFilter();
    };`,
    };
}
