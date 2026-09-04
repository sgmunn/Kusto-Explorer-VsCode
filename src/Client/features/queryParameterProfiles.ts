// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';

const STORAGE_KEY = 'msKustoExplorer.queryParameterProfiles';

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

/** Parses the workspace parameter-file format into the runtime profile model. */
export function parseParameterFile(contents: string): StoredProfiles | undefined {
    const file = parse(contents) as ParameterFile | null;
    if (!file || typeof file !== 'object' || !file.profiles || typeof file.profiles !== 'object') return undefined;
    const profiles = Object.entries(file.profiles).flatMap(([name, values]) => {
        if (!values || typeof values !== 'object') return [];
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === null || value === undefined) continue;
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

/** Workspace-scoped parameter profiles and their status-bar selector. */
export class QueryParameterProfiles {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly fileUri: vscode.Uri | undefined;
    private readonly directoryUri: vscode.Uri | undefined;
    private stored: StoredProfiles;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.stored = this.readWorkspaceState();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        this.directoryUri = workspaceFolder && vscode.Uri.joinPath(workspaceFolder.uri, '.kusto');
        this.fileUri = this.directoryUri && vscode.Uri.joinPath(this.directoryUri, 'parameters.yaml');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
        this.statusBarItem.command = 'msKustoExplorer.selectQueryParameterProfile';
        context.subscriptions.push(this.statusBarItem, vscode.window.onDidChangeActiveTextEditor(() => this.refreshStatusBar()));
        if (this.fileUri && workspaceFolder) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, '.kusto/parameters.yaml'));
            watcher.onDidChange(() => void this.loadWorkspaceFile());
            watcher.onDidCreate(() => void this.loadWorkspaceFile());
            watcher.onDidDelete(() => { this.stored = this.readWorkspaceState(); this.refreshStatusBar(); });
            context.subscriptions.push(watcher);
            void this.loadWorkspaceFile();
        }
        this.refreshStatusBar();
    }

    getActiveValues(): Record<string, string> {
        const active = this.stored.profiles.find(profile => profile.name === this.stored.activeProfileName);
        return active ? { ...active.values } : {};
    }

    async selectProfile(): Promise<void> {
        const stored = this.stored;
        const picked = await vscode.window.showQuickPick([
            ...stored.profiles.map(profile => ({ label: profile.name, description: this.describeValues(profile.values) })),
            { label: '$(add) Create parameter profile', description: 'Create a reusable set of values' },
            { label: '$(circle-slash) No active profile', description: 'Run without extension parameters' },
        ], { placeHolder: 'Select query parameter profile' });
        if (!picked) return;
        if (picked.label === '$(add) Create parameter profile') return this.createProfile();
        stored.activeProfileName = picked.label === '$(circle-slash) No active profile' ? undefined : picked.label;
        await this.save(stored);
    }

    async createProfile(): Promise<void> {
        const name = await vscode.window.showInputBox({ prompt: 'Profile name', placeHolder: 'Incident A' });
        if (!name?.trim()) return;
        const rawValues = await vscode.window.showInputBox({
            prompt: 'Parameter values, separated by semicolons',
            placeHolder: 'raid=abc43e90-30af-4e17-a306-37ac5d0c008d; environment=prod'
        });
        if (rawValues === undefined) return;
        const values = parseParameterValues(rawValues);
        if (!values) return void vscode.window.showErrorMessage('Parameters must use name=value pairs separated by semicolons.');
        const stored = this.stored;
        const profile: QueryParameterProfile = { name: name.trim(), values };
        const existing = stored.profiles.findIndex(item => item.name === profile.name);
        if (existing >= 0) stored.profiles[existing] = profile;
        else stored.profiles.push(profile);
        stored.activeProfileName = profile.name;
        await this.save(stored);
    }

    async editActiveProfile(): Promise<void> {
        const stored = this.stored;
        const active = stored.profiles.find(profile => profile.name === stored.activeProfileName);
        if (!active) return this.createProfile();
        const rawValues = await vscode.window.showInputBox({
            prompt: `Values for ${active.name}`,
            value: Object.entries(active.values).map(([key, value]) => `${key}=${value}`).join('; ')
        });
        if (rawValues === undefined) return;
        const values = parseParameterValues(rawValues);
        if (!values) return void vscode.window.showErrorMessage('Parameters must use name=value pairs separated by semicolons.');
        active.values = values;
        await this.save(stored);
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

    private readWorkspaceState(): StoredProfiles {
        const stored = this.context.workspaceState.get<StoredProfiles>(STORAGE_KEY);
        return { activeProfileName: stored?.activeProfileName, profiles: stored?.profiles ?? [] };
    }

    private async save(stored: StoredProfiles): Promise<void> {
        this.stored = stored;
        await this.context.workspaceState.update(STORAGE_KEY, stored);
        if (this.fileUri && this.directoryUri) {
            await vscode.workspace.fs.createDirectory(this.directoryUri);
            await vscode.workspace.fs.writeFile(this.fileUri, Buffer.from(serializeParameterFile(stored), 'utf8'));
        }
        this.refreshStatusBar();
    }

    private async loadWorkspaceFile(): Promise<void> {
        if (!this.fileUri) return;
        try {
            const contents = Buffer.from(await vscode.workspace.fs.readFile(this.fileUri)).toString('utf8');
            const stored = parseParameterFile(contents);
            if (!stored) throw new Error('Expected an `active` profile and a `profiles` mapping.');
            this.stored = stored;
            await this.context.workspaceState.update(STORAGE_KEY, stored);
            this.refreshStatusBar();
        } catch (error) {
            const code = error instanceof vscode.FileSystemError ? error.code : undefined;
            if (code !== 'FileNotFound') vscode.window.showWarningMessage(`Could not read .kusto/parameters.yaml: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private refreshStatusBar(): void {
        if (vscode.window.activeTextEditor?.document.languageId !== 'kusto') return this.statusBarItem.hide();
        const active = this.stored.profiles.find(profile => profile.name === this.stored.activeProfileName);
        this.statusBarItem.text = active ? `$(symbol-variable) Params: ${active.name}` : '$(symbol-variable) Params: none';
        this.statusBarItem.tooltip = active
            ? `Query parameters: ${this.describeValues(active.values)}\nClick to switch profile.`
            : 'No query parameter profile is active. Click to choose one.';
        this.statusBarItem.show();
    }

    private describeValues(values: Record<string, string>): string {
        const entries = Object.entries(values).map(([key, value]) => `${key}=${value}`);
        return entries.length ? entries.join(', ') : 'no values';
    }
}
