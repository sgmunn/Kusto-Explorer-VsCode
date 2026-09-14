// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { generateParameterDeclaration, getQueryParameterFilePath, mergeImportedProfiles, parseParameterFile, parseParameterProfilesJson, parseParameterValues, serializeParameterFile } from '../../features/queryParameterProfiles';

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

    it('generates declarations using conservative scalar type inference', () => {
        expect(generateParameterDeclaration({
            text: '123abc',
            count: '-42',
            ratio: '1.25',
            scientific: '6e4',
            day: '2026-09-14',
            timestamp: '2026-09-14T12:34:56Z',
            ambiguousDate: '09/14/2026',
            empty: '',
        })).toBe(
            'declare query_parameters(text:string, count:long, ratio:real, scientific:real, day:datetime, timestamp:datetime, ambiguousDate:string, empty:string);'
        );
    });

    it('does not generate a declaration without parameters', () => {
        expect(generateParameterDeclaration({})).toBeUndefined();
    });

    it('converts one JSON object into a parameter profile', () => {
        expect(parseParameterProfilesJson(JSON.stringify({
            RootActivityId: '9014e5c7-4fce-4a39-9b0e-fea5572b6e88',
            MinTimestamp: '2026-09-01T04:03:53.4650457Z',
            Attempt: 3,
            Enabled: true,
        }))).toEqual([{
            name: 'Group1',
            values: {
                RootActivityId: '9014e5c7-4fce-4a39-9b0e-fea5572b6e88',
                MinTimestamp: '2026-09-01T04:03:53.4650457Z',
                Attempt: '3',
                Enabled: 'true',
            },
        }]);
    });

    it('converts arrays into groups and ignores nested, null, and invalid values', () => {
        expect(parseParameterProfilesJson(JSON.stringify([
            { Environment: 'Daily', Nested: { ignored: true }, Items: [1, 2], Missing: null },
            { Cluster: 'pbipdailyeus2euap', 'invalid-name': 'ignored' },
            'not an object',
        ]))).toEqual([
            { name: 'Group1', values: { Environment: 'Daily' } },
            { name: 'Group2', values: { Cluster: 'pbipdailyeus2euap' } },
        ]);
    });

    it('rejects invalid JSON and unsupported top-level values', () => {
        expect(parseParameterProfilesJson('{ invalid')).toBeUndefined();
        expect(parseParameterProfilesJson('42')).toBeUndefined();
        expect(parseParameterProfilesJson('[{"Nested":{"ignored":true}}, {}]')).toBeUndefined();
    });

    it('merges imported profiles using available Group names and activates the first import', () => {
        const existing = {
            activeProfileName: 'Incident A',
            profiles: [
                { name: 'Incident A', values: { raid: 'abc' } },
                { name: 'Group1', values: { old: 'one' } },
                { name: 'Group3', values: { old: 'three' } },
            ],
        };
        expect(mergeImportedProfiles(existing, [
            { name: 'Group1', values: { Environment: 'Daily' } },
            { name: 'Group2', values: { Cluster: 'pbipdailyeus2euap' } },
        ])).toEqual({
            activeProfileName: 'Group2',
            profiles: [
                ...existing.profiles,
                { name: 'Group2', values: { Environment: 'Daily' } },
                { name: 'Group4', values: { Cluster: 'pbipdailyeus2euap' } },
            ],
        });
    });
});
