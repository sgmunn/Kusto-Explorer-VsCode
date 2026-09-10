import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// Installing beside the upstream extension must not reuse its global registrations.
describe('KustoTraceTools extension identity', () => {
    it('uses a separate package identity and visible brand', () => {
        expect(`${manifest.publisher}.${manifest.name}`).toBe('local.kustotracetools');
        expect(manifest.displayName).toBe('KustoTraceTools');
        expect(manifest.author).toBe('KustoTraceTools contributors');
        expect(manifest.contributes.viewsContainers.activitybar[0].title).toBe('KustoTraceTools');
        expect(manifest.contributes.customEditors[0].displayName).toBe('KustoTraceTools Results');
        expect(manifest.contributes.chatParticipants[0]).toMatchObject({
            id: 'kustoTraceTools', name: 'kustotracetools', fullName: 'KustoTraceTools',
        });
    });

    it('isolates commands, views, settings and Copilot tools from upstream', () => {
        const { contributes } = manifest;
        const commands = contributes.commands as { command: string }[];
        const tools = contributes.languageModelTools as { name: string; toolReferenceName: string }[];
        const views = Object.values(contributes.views).flat() as { id: string }[];
        const containers = Object.values(contributes.viewsContainers).flat() as { id: string }[];
        const settings = contributes.configuration.flatMap((section: { properties: object }) => Object.keys(section.properties)) as string[];
        const ids = [...commands.map(c => c.command), ...views.map(v => v.id), ...containers.map(v => v.id),
            ...tools.map(t => t.name), ...settings];
        expect(ids.length).toBeGreaterThan(100);
        for (const id of ids) expect(id).toMatch(/^kustoTraceTools[._]/);
        for (const tool of tools) expect(tool.toolReferenceName).toMatch(/^kustoTraceTools/);
        expect(new Set(tools.map(t => t.toolReferenceName)).size).toBe(tools.length);
        const commandIds = new Set(commands.map(c => c.command));
        for (const binding of contributes.keybindings) {
            if (binding.command.startsWith('kustoTraceTools.')) expect(commandIds.has(binding.command)).toBe(true);
        }
        expect(JSON.stringify(manifest)).not.toContain('msKustoExplorer');
    });

    it('preserves KQL and result-file support while isolating virtual documents', () => {
        expect(manifest.contributes.languages[0]).toMatchObject({ id: 'kusto', extensions: ['.kql', '.csl', '.kusto'] });
        expect(manifest.contributes.grammars[0].language).toBe('kusto');
        expect(manifest.contributes.customEditors[0]).toMatchObject({
            viewType: 'kustoTraceTools_resultViewer', selector: [{ filenamePattern: '*.kqr' }],
        });
        expect(manifest.activationEvents).toContain('onFileSystem:kustoTraceTools-scratch');
        const server = readFileSync(new URL('../../../Server/Server.cs', import.meta.url), 'utf8');
        expect(server).toContain('EntityDefinitionScheme = "kustotracetools-entity"');
        const client = readFileSync(new URL('../../features/entityDefinitionProvider.ts', import.meta.url), 'utf8');
        expect(client).toContain("ENTITY_DEFINITION_SCHEME = 'kustotracetools-entity'");
    });
});
