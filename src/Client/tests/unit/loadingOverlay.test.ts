// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import {
    createLoadingOverlayContribution,
    LARGE_RESULT_LOADING_THRESHOLD,
} from '../../features/workbenchGrid/loadingOverlay';

describe('workbench grid loading overlay', () => {
    it('renders only for large result sets and requests a pre-grid paint', () => {
        const contribution = createLoadingOverlayContribution();

        expect(contribution.yieldBeforeCreateAtRowCount).toBe(LARGE_RESULT_LOADING_THRESHOLD);
        expect(contribution.headHtml).toContain('.workbench-grid-loading-overlay');
        expect(contribution.beforeCreateScript)
            .toContain(`tableData.rows.length >= ${LARGE_RESULT_LOADING_THRESHOLD}`);
        expect(contribution.beforeCreateScript).toContain("container.setAttribute('aria-busy', 'true')");
        expect(contribution.beforeCreateScript).toContain("'Rendering '");
        expect(contribution.afterCreateScript).toContain("classList.add('leaving')");
        expect(contribution.afterCreateScript).toContain('workbenchPreviousCleanup');
        expect(() => Function(contribution.beforeCreateScript ?? '')).not.toThrow();
        expect(() => Function(contribution.afterCreateScript ?? '')).not.toThrow();
    });

    it('allows the large-result threshold to be adjusted', () => {
        const contribution = createLoadingOverlayContribution(250);

        expect(contribution.yieldBeforeCreateAtRowCount).toBe(250);
        expect(contribution.beforeCreateScript).toContain('tableData.rows.length >= 250');
    });
});
