// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { getQueryParameterFilePath, parseParameterFile, parseParameterValues, serializeParameterFile } from '../../features/queryParameterProfiles';

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

    it('maps a KQL file to an adjacent query-specific parameter file', () => {
        expect(getQueryParameterFilePath('/queries/investigate.kql')).toBe('/queries/investigate.parameters.yaml');
        expect(getQueryParameterFilePath('/queries/INVESTIGATE.KQL')).toBe('/queries/INVESTIGATE.parameters.yaml');
        expect(getQueryParameterFilePath('/queries/investigate.csl')).toBeUndefined();
    });
});
