// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { activateParameterProfile, findParameterProfileLocations, generateParameterDeclaration, getQueryParameterFilePath, isQueryParameterFilePath, mergeImportedProfiles, parseParameterFile, parseParameterProfilesJson, parseParameterValues, serializeParameterFile } from '../../features/queryParameterProfiles';

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

        it('recognizes global and query-specific parameter YAML files', () => {
                expect(isQueryParameterFilePath('/workspace/.kusto/parameters.yaml')).toBe(true);
                expect(isQueryParameterFilePath('/workspace/queries/investigate.parameters.yaml')).toBe(true);
                expect(isQueryParameterFilePath('/workspace/parameters.yaml')).toBe(false);
                expect(isQueryParameterFilePath('/workspace/queries/investigate.yaml')).toBe(false);
        });

        it('finds profile key locations and identifies the active group', () => {
                const contents = `active: Group2
profiles:
    Group1:
        Environment: Daily
    Group2:
        Environment: Prod
`;
                expect(findParameterProfileLocations(contents)).toEqual([
                        { name: 'Group1', line: 2, character: 4, length: 6, isActive: false },
                        { name: 'Group2', line: 4, character: 4, length: 6, isActive: true },
                ]);
        });

        it('activates a profile with structured YAML editing and preserves comments', () => {
                const contents = `# selected incident
active: Group1
profiles:
    Group1:
        Environment: Daily
    Group2: # production
        Environment: Prod
`;
                const updated = activateParameterProfile(contents, 'Group2');
                expect(updated).toContain('# selected incident');
                expect(updated).toContain('active: "Group2"');
                expect(updated).toContain('Group2: # production');
                expect(parseParameterFile(updated!)).toMatchObject({ activeProfileName: 'Group2' });
                expect(activateParameterProfile(contents, 'Missing')).toBeUndefined();
        });

            it('quotes profile names that contain YAML syntax', () => {
                const contents = [
                    'active: Group1',
                    'profiles:',
                    '    Group1:',
                    '        Environment: Daily',
                    '    "Group: #2":',
                    '        Environment: Prod',
                    '',
                ].join('\n');
                const updated = activateParameterProfile(contents, 'Group: #2');
                expect(parseParameterFile(updated!)).toMatchObject({ activeProfileName: 'Group: #2' });
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
