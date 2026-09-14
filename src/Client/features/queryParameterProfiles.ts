// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import { isMap, isScalar, LineCounter, parse, parseDocument, stringify } from 'yaml';

const STORAGE_KEY = 'kustoTraceTools.queryParameterProfiles';
const INTEGER_PATTERN = /^[+-]?\d+$/;
const REAL_PATTERN = /^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+|\d+\.\d*[eE][+-]?\d+|\d*\.\d+[eE][+-]?\d+)$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface QueryParameterProfile {
    name: string;
    values: Record<string, string>;
}

interface StoredProfiles {
    activeProfileName?: string | undefined;
    profiles: QueryParameterProfile[];
}

interface ParameterFile {
    active?: string | undefined;
    profiles?: Record<string, Record<string, unknown>>;
}

interface ProfileTarget {
    stored: StoredProfiles;
    fileUri: vscode.Uri | undefined;
    directoryUri: vscode.Uri | undefined;
    scope: 'query' | 'workspace';
}

export interface ParameterProfileLocation {
    name: string;
    line: number;
    character: number;
    length: number;
    isActive: boolean;
}

/** Returns the adjacent parameter sidecar path for a KQL file. */
export function getQueryParameterFilePath(queryPath: string): string | undefined {
    return /\.kql$/i.test(queryPath) ? queryPath.slice(0, -4) + '.parameters.yaml' : undefined;
}

/** Returns whether a path is the workspace parameter file or a query sidecar. */
export function isQueryParameterFilePath(filePath: string): boolean {
    return /(?:^|\/)\.kusto\/parameters\.yaml$/i.test(filePath) || /\.parameters\.yaml$/i.test(filePath);
}

/** Finds direct profile keys and their editor positions using the YAML syntax tree. */
export function findParameterProfileLocations(contents: string): ParameterProfileLocation[] {
    const lineCounter = new LineCounter();
    const document = parseDocument(contents, { lineCounter });
    if (document.errors.length) return [];
    const profiles = document.get('profiles', true);
    if (!isMap(profiles)) return [];
    const active = document.get('active');

    return profiles.items.flatMap(pair => {
        const key = pair.key;
        if (!isScalar(key) || typeof key.value !== 'string' || !key.range) return [];
        const position = lineCounter.linePos(key.range[0]);
        const lineStart = contents.lastIndexOf('\n', key.range[0] - 1) + 1;
        return [{
            name: key.value,
            line: position.line - 1,
            character: key.range[0] - lineStart,
            length: key.range[1] - key.range[0],
            isActive: key.value === active,
        }];
    });
}

/** Updates the top-level active profile while retaining YAML comments and structure. */
export function activateParameterProfile(contents: string, profileName: string): string | undefined {
    const document = parseDocument(contents);
    if (document.errors.length) return undefined;
    const profiles = document.get('profiles', true);
    if (!isMap(profiles) || !profiles.has(profileName)) return undefined;
    const active = document.get('active', true);
    if (isScalar(active) && active.range) {
        return contents.slice(0, active.range[0]) + JSON.stringify(profileName) + contents.slice(active.range[1]);
    }
    document.set('active', profileName);
    return document.toString();
}

function getMinimalTextReplacement(original: string, updated: string): { start: number; end: number; text: string } {
    let start = 0;
    while (start < original.length && start < updated.length && original[start] === updated[start]) start++;
    let originalEnd = original.length;
    let updatedEnd = updated.length;
    while (originalEnd > start && updatedEnd > start && original[originalEnd - 1] === updated[updatedEnd - 1]) {
        originalEnd--;
        updatedEnd--;
    }
    return { start, end: originalEnd, text: updated.slice(start, updatedEnd) };
}

class QueryParameterProfileCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!isQueryParameterFilePath(document.uri.path)) return [];
        return findParameterProfileLocations(document.getText()).map(profile => new vscode.CodeLens(
            new vscode.Range(profile.line, profile.character, profile.line, profile.character + profile.length),
            profile.isActive
                ? { title: '$(check) Active', command: 'kustoTraceTools.noop' }
                : {
                    title: 'Make Active',
                    command: 'kustoTraceTools.makeQueryParameterProfileActive',
                    arguments: [document.uri, profile.name],
                }
        ));
    }
}

/** Parses `name=value; other=value` input used by the lightweight editor UI. */
export function parseParameterValues(input: string): Record<string, string> | undefined {
    const values: Record<string, string> = {};
    for (const entry of input.split(';').map(part => part.trim()).filter(Boolean)) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(entry);
        if (!match) return undefined;
        values[match[1]!] = match[2]!.trim();
    }
    return values;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts a JSON object or array of objects into numbered parameter profiles. */
export function parseParameterProfilesJson(contents: string): QueryParameterProfile[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(contents) as unknown;
    } catch {
        return undefined;
    }

    const groups = (Array.isArray(parsed) ? parsed : [parsed]).filter(isJsonObject);
    if (!groups.length) return undefined;

    const values = groups.map(group => Object.fromEntries(Object.entries(group).flatMap(([name, value]) =>
            PARAMETER_NAME_PATTERN.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
                ? [[name, String(value)]]
                : [])))
        .filter(groupValues => Object.keys(groupValues).length > 0);
    return values.length
        ? values.map((groupValues, index) => ({ name: `Group${index + 1}`, values: groupValues }))
        : undefined;
}

/** Appends imported profiles under unused GroupN names and activates the first new group. */
export function mergeImportedProfiles(stored: StoredProfiles, importedProfiles: readonly QueryParameterProfile[]): StoredProfiles {
    const usedNames = new Set(stored.profiles.map(profile => profile.name));
    let nextGroupNumber = 1;
    const renamedProfiles = importedProfiles.map(profile => {
        while (usedNames.has(`Group${nextGroupNumber}`)) nextGroupNumber++;
        const name = `Group${nextGroupNumber++}`;
        usedNames.add(name);
        return { ...profile, name };
    });
    return {
        activeProfileName: renamedProfiles[0]?.name ?? stored.activeProfileName,
        profiles: [...stored.profiles, ...renamedProfiles],
    };
}

function inferParameterType(value: string): 'string' | 'long' | 'real' | 'datetime' {
    if (ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))) return 'datetime';
    if (INTEGER_PATTERN.test(value)) return 'long';
    if (REAL_PATTERN.test(value)) return 'real';
    return 'string';
}

/** Generates a KQL declaration for a profile's parameter names and inferred scalar types. */
export function generateParameterDeclaration(values: Readonly<Record<string, string>>): string | undefined {
    const declarations = Object.entries(values).map(([name, value]) => `${name}:${inferParameterType(value)}`);
    return declarations.length ? `declare query_parameters(${declarations.join(', ')});` : undefined;
}

/** Parses the workspace parameter-file format into the runtime profile model. */
export function parseParameterFile(contents: string): StoredProfiles | undefined {
    const file = parse(contents) as ParameterFile | null;
    if (!file || typeof file !== 'object' || !file.profiles || typeof file.profiles !== 'object') return undefined;
    const profiles = Object.entries(file.profiles).flatMap(([name, values]) => {
        if (!values || typeof values !== 'object') return [];
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
            if (!PARAMETER_NAME_PATTERN.test(key) || value === null || value === undefined) continue;
            normalized[key] = String(value);
        }
        return [{ name, values: normalized }];
    });
    const activeProfileName = typeof file.active === 'string' && profiles.some(profile => profile.name === file.active)
        ? file.active
        : undefined;
    return { activeProfileName, profiles };
}

export function serializeParameterFile(stored: StoredProfiles): string {
    return stringify({
        active: stored.activeProfileName ?? null,
        profiles: Object.fromEntries(stored.profiles.map(profile => [profile.name, profile.values])),
    });
}

/** Workspace- and query-scoped parameter profiles and their status-bar selector. */
export class QueryParameterProfiles {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly fileUri: vscode.Uri | undefined;
    private readonly directoryUri: vscode.Uri | undefined;
    private stored: StoredProfiles;
    private statusRefreshGeneration = 0;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.stored = this.readWorkspaceState();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        this.directoryUri = workspaceFolder && vscode.Uri.joinPath(workspaceFolder.uri, '.kusto');
        this.fileUri = this.directoryUri && vscode.Uri.joinPath(this.directoryUri, 'parameters.yaml');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
        this.statusBarItem.command = 'kustoTraceTools.selectQueryParameterProfile';
        context.subscriptions.push(
            this.statusBarItem,
            vscode.window.onDidChangeActiveTextEditor(() => void this.refreshStatusBar()),
            vscode.languages.registerCodeLensProvider([
                { scheme: 'file', pattern: '**/.kusto/parameters.yaml' },
                { scheme: 'file', pattern: '**/*.parameters.yaml' },
            ], new QueryParameterProfileCodeLensProvider())
        );
        if (this.fileUri && workspaceFolder) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, '.kusto/parameters.yaml'));
            watcher.onDidChange(() => void this.loadWorkspaceFile());
            watcher.onDidCreate(() => void this.loadWorkspaceFile());
            watcher.onDidDelete(() => { this.stored = this.readWorkspaceState(); void this.refreshStatusBar(); });
            const queryWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, '**/*.parameters.yaml'));
            queryWatcher.onDidChange(() => void this.refreshStatusBar());
            queryWatcher.onDidCreate(() => void this.refreshStatusBar());
            queryWatcher.onDidDelete(() => void this.refreshStatusBar());
            context.subscriptions.push(watcher, queryWatcher);
            void this.loadWorkspaceFile();
        }
        void this.refreshStatusBar();
    }

    async getActiveValues(documentUri?: vscode.Uri): Promise<Record<string, string>> {
        const target = await this.getTarget(documentUri);
        const active = target.stored.profiles.find(profile => profile.name === target.stored.activeProfileName);
        return active ? { ...active.values } : {};
    }

    async selectProfile(): Promise<void> {
        const target = await this.getTarget(this.activeQueryUri());
        const stored = target.stored;
        const picked = await vscode.window.showQuickPick([
            ...stored.profiles.map(profile => ({ label: profile.name, description: this.describeValues(profile.values) })),
            { label: '$(add) Create parameter profile', description: 'Create a reusable set of values' },
            { label: '$(json) Import profiles from clipboard JSON', description: 'Create Group1, Group2, ... from JSON objects' },
            { label: '$(circle-slash) No active profile', description: 'Run without extension parameters' },
        ], { placeHolder: 'Select query parameter profile' });
        if (!picked) return;
        if (picked.label === '$(add) Create parameter profile') return this.createProfileForTarget(target);
        if (picked.label === '$(json) Import profiles from clipboard JSON') return this.importProfilesFromClipboard(target);
        stored.activeProfileName = picked.label === '$(circle-slash) No active profile' ? undefined : picked.label;
        await this.save(target);
    }

    async createProfile(): Promise<void> {
        return this.createProfileForTarget();
    }

    async importProfilesFromClipboard(existingTarget?: ProfileTarget): Promise<void> {
        const target = existingTarget ?? await this.getTarget(this.activeQueryUri());
        const contents = await vscode.env.clipboard.readText();
        const parsedProfiles = parseParameterProfilesJson(contents);
        if (!parsedProfiles) {
            vscode.window.showErrorMessage('Clipboard must contain a JSON object or an array containing at least one object.');
            return;
        }

        const stored = mergeImportedProfiles(target.stored, parsedProfiles);
        await this.save({ ...target, stored });
        vscode.window.showInformationMessage(`Imported ${parsedProfiles.length} parameter ${parsedProfiles.length === 1 ? 'group' : 'groups'} from the clipboard.`);
    }

    async makeProfileActive(fileUri: vscode.Uri, profileName: string): Promise<void> {
        if (!isQueryParameterFilePath(fileUri.path)) return;
        const document = await vscode.workspace.openTextDocument(fileUri);
        const original = document.getText();
        const updated = activateParameterProfile(original, profileName);
        if (updated === undefined) {
            vscode.window.showErrorMessage(`Query parameter profile '${profileName}' was not found.`);
            return;
        }

        const replacement = getMinimalTextReplacement(original, updated);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(fileUri, new vscode.Range(document.positionAt(replacement.start), document.positionAt(replacement.end)), replacement.text);
        if (!await vscode.workspace.applyEdit(edit)) {
            vscode.window.showErrorMessage(`Could not activate query parameter profile '${profileName}'.`);
            return;
        }
        if (!await document.save()) {
            vscode.window.showErrorMessage(`Query parameter profile '${profileName}' is active in the editor but could not be saved.`);
            return;
        }
        await this.refreshStatusBar();
    }

    private async createProfileForTarget(existingTarget?: ProfileTarget): Promise<void> {
        const target = existingTarget ?? await this.getTarget(this.activeQueryUri());
        const name = await vscode.window.showInputBox({ prompt: 'Profile name', placeHolder: 'Incident A' });
        if (!name?.trim()) return;
        const rawValues = await vscode.window.showInputBox({
            prompt: 'Parameter values, separated by semicolons',
            placeHolder: 'raid=abc43e90-30af-4e17-a306-37ac5d0c008d; environment=prod'
        });
        if (rawValues === undefined) return;
        const values = parseParameterValues(rawValues);
        if (!values) return void vscode.window.showErrorMessage('Parameters must use name=value pairs separated by semicolons.');
        const stored = target.stored;
        const profile: QueryParameterProfile = { name: name.trim(), values };
        const existing = stored.profiles.findIndex(item => item.name === profile.name);
        if (existing >= 0) stored.profiles[existing] = profile;
        else stored.profiles.push(profile);
        stored.activeProfileName = profile.name;
        await this.save(target);
    }

    async editActiveProfile(): Promise<void> {
        const target = await this.getTarget(this.activeQueryUri());
        const stored = target.stored;
        const active = stored.profiles.find(profile => profile.name === stored.activeProfileName);
        if (!active) return this.createProfileForTarget(target);
        const rawValues = await vscode.window.showInputBox({
            prompt: `Values for ${active.name}`,
            value: Object.entries(active.values).map(([key, value]) => `${key}=${value}`).join('; ')
        });
        if (rawValues === undefined) return;
        const values = parseParameterValues(rawValues);
        if (!values) return void vscode.window.showErrorMessage('Parameters must use name=value pairs separated by semicolons.');
        active.values = values;
        await this.save(target);
    }

    async openParameterFile(): Promise<void> {
        if (!this.fileUri) {
            vscode.window.showErrorMessage('Open a workspace folder to use parameters.yaml.');
            return;
        }
        try {
            await vscode.workspace.fs.createDirectory(this.directoryUri!);
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            } catch {
                await vscode.workspace.fs.writeFile(this.fileUri, Buffer.from(serializeParameterFile(this.stored), 'utf8'));
            }
            await vscode.window.showTextDocument(this.fileUri);
        } catch (error) {
            vscode.window.showErrorMessage(`Unable to open parameters.yaml: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async openQueryParameterFile(): Promise<void> {
        const queryUri = this.activeQueryUri();
        const scopedUri = queryUri && this.getQueryParameterFileUri(queryUri);
        if (!queryUri || !scopedUri) {
            vscode.window.showErrorMessage('Open a saved .kql file to use query-specific parameters.');
            return;
        }
        try {
            try {
                await vscode.workspace.fs.stat(scopedUri);
            } catch (error) {
                if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
                const effective = await this.getTarget(queryUri);
                await vscode.workspace.fs.writeFile(scopedUri, Buffer.from(serializeParameterFile(effective.stored), 'utf8'));
            }
            await vscode.window.showTextDocument(scopedUri);
            void this.refreshStatusBar();
        } catch (error) {
            vscode.window.showErrorMessage(`Unable to open query parameters file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private readWorkspaceState(): StoredProfiles {
        const stored = this.context.workspaceState.get<StoredProfiles>(STORAGE_KEY);
        return { activeProfileName: stored?.activeProfileName, profiles: stored?.profiles ?? [] };
    }

    private async save(target: ProfileTarget): Promise<void> {
        if (target.scope === 'workspace') {
            this.stored = target.stored;
            await this.context.workspaceState.update(STORAGE_KEY, target.stored);
        }
        if (target.fileUri) {
            if (target.directoryUri) await vscode.workspace.fs.createDirectory(target.directoryUri);
            await vscode.workspace.fs.writeFile(target.fileUri, Buffer.from(serializeParameterFile(target.stored), 'utf8'));
        }
        void this.refreshStatusBar();
    }

    private async loadWorkspaceFile(): Promise<void> {
        if (!this.fileUri) return;
        try {
            const contents = Buffer.from(await vscode.workspace.fs.readFile(this.fileUri)).toString('utf8');
            const stored = parseParameterFile(contents);
            if (!stored) throw new Error('Expected an `active` profile and a `profiles` mapping.');
            this.stored = stored;
            await this.context.workspaceState.update(STORAGE_KEY, stored);
            void this.refreshStatusBar();
        } catch (error) {
            const code = error instanceof vscode.FileSystemError ? error.code : undefined;
            if (code !== 'FileNotFound') vscode.window.showWarningMessage(`Could not read .kusto/parameters.yaml: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private activeQueryUri(): vscode.Uri | undefined {
        const document = vscode.window.activeTextEditor?.document;
        return document?.languageId === 'kusto' ? document.uri : undefined;
    }

    private getQueryParameterFileUri(queryUri: vscode.Uri): vscode.Uri | undefined {
        if (queryUri.scheme !== 'file') return undefined;
        const scopedPath = getQueryParameterFilePath(queryUri.path);
        return scopedPath ? queryUri.with({ path: scopedPath }) : undefined;
    }

    private async getTarget(documentUri?: vscode.Uri): Promise<ProfileTarget> {
        const scopedUri = documentUri && this.getQueryParameterFileUri(documentUri);
        if (scopedUri) {
            const scoped = await this.readParameterFile(scopedUri, scopedUri.fsPath);
            if (scoped !== undefined) {
                return {
                    stored: scoped,
                    fileUri: scopedUri,
                    directoryUri: undefined,
                    scope: 'query',
                };
            }
        }
        return { stored: this.stored, fileUri: this.fileUri, directoryUri: this.directoryUri, scope: 'workspace' };
    }

    private async readParameterFile(fileUri: vscode.Uri, displayPath: string): Promise<StoredProfiles | undefined> {
        try {
            const contents = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
            const stored = parseParameterFile(contents);
            if (!stored) throw new Error('Expected an `active` profile and a `profiles` mapping.');
            return stored;
        } catch (error) {
            const code = error instanceof vscode.FileSystemError ? error.code : undefined;
            if (code === 'FileNotFound') return undefined;
            vscode.window.showWarningMessage(`Could not read ${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
            return { profiles: [] };
        }
    }

    private async refreshStatusBar(): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (document?.languageId !== 'kusto') return this.statusBarItem.hide();
        const generation = ++this.statusRefreshGeneration;
        const target = await this.getTarget(document.uri);
        if (generation !== this.statusRefreshGeneration || vscode.window.activeTextEditor?.document !== document) return;
        const active = target.stored.profiles.find(profile => profile.name === target.stored.activeProfileName);
        const scope = target.scope === 'query' ? 'query file' : 'workspace';
        this.statusBarItem.text = active ? `$(symbol-variable) Params: ${active.name}` : '$(symbol-variable) Params: none';
        this.statusBarItem.tooltip = active
            ? `Query parameters (${scope}): ${this.describeValues(active.values)}\nClick to switch profile.`
            : `No ${scope} parameter profile is active. Click to choose one.`;
        this.statusBarItem.show();
    }

    private describeValues(values: Record<string, string>): string {
        const entries = Object.entries(values).map(([key, value]) => `${key}=${value}`);
        return entries.length ? entries.join(', ') : 'no values';
    }
}
