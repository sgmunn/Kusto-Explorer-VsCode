// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { parseParameterFile, parseParameterValues, serializeParameterFile } from '../../features/queryParameterProfiles';

describe('query parameter profiles', () => {
    it('parses semicolon-separated parameter values', () => {
        expect(parseParameterValues('raid=abc-123; environment=prod')).toEqual({
            raid: 'abc-123',
            environment: 'prod',
        });
    });

    it('allows an empty value but rejects an invalid name', () => {
        expect(parseParameterValues('raid=')).toEqual({ raid: '' });
        expect(parseParameterValues('not a parameter')).toBeUndefined();
        expect(parseParameterValues('1raid=value')).toBeUndefined();
    });

    it('reads and writes profiles in the workspace YAML format', () => {
        const profiles = parseParameterFile(`active: Incident A
profiles:
  Incident A:
    raid: abc-123
    environment: prod
`);
        expect(profiles).toEqual({
            activeProfileName: 'Incident A',
            profiles: [{ name: 'Incident A', values: { raid: 'abc-123', environment: 'prod' } }],
        });
        expect(parseParameterFile(serializeParameterFile(profiles!))).toEqual(profiles);
    });
});
