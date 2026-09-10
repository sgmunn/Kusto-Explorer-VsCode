// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/*
 * This module implements the ImportManager class, which handles the logic
 * of importing connections and scratch pads from desktop Kusto Explorer.
 * It is UI-free — the Importer class handles prompts and messages.
 */

import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { type ConnectionManager, isServerGroup } from './connectionManager';
import type { ServerInfo, ServerGroupInfo } from './connectionManager';
import type { ScratchPadManager } from './scratchPadManager';

// =============================================================================
// Constants
// =============================================================================

/** Kusto Explorer user data directory name under %LOCALAPPDATA%. */
const KUSTO_EXPLORER_DIR = 'Kusto.Explorer';

/** Filename for the groups index. */
const GROUPS_FILE = 'UserConnectionGroups.xml';

/** Default group name used by Kusto Explorer for ungrouped connections. */
const DEFAULT_GROUP_NAME = 'Connections';

/** Recovery directory under Kusto Explorer for scratch pad backup files. */
const RECOVERY_DIR = 'Recovery';

/** Extension for Kusto Explorer scratch pad backup files. */
const RECOVERY_EXT = '.kebak';

// =============================================================================
// Types
// =============================================================================

/** Shape of a Kusto Explorer scratch pad recovery (.kebak) file. */
export interface KustoExplorerRecoveryFile {
    CustomTitle?: string;
    QueryText?: string;
    ConnectionString?: string;
    TabOrdinal?: number;
    FullPath?: string;
}

/** Result of importing connections. */
export interface ImportConnectionsResult {
    importedCount: number;
    skippedCount: number;
}

/** Result of importing scratch pads. */
export interface ImportScratchPadsResult {
    importedCount: number;
}

// =============================================================================
// ImportManager Class
// =============================================================================

/**
 * Handles the logic of importing connections and scratch pads from desktop Kusto Explorer.
 * This class is UI-free — the Importer class handles prompts and messages.
 */
export class ImportManager {
    constructor(
        private readonly scratchPadManager: ScratchPadManager,
        private readonly connections: ConnectionManager,
    ) {}

    // ─── Discovery ───────────────────────────────────────────────────

    /** Returns true if there are connections from Kusto Explorer to import. */
    hasConnectionsToImport(): boolean {
        const groupsPath = this.getGroupsFilePath();
        return !!groupsPath && fs.existsSync(groupsPath);
    }

    /** Returns true if there are scratch pads from Kusto Explorer to import. */
    hasScratchPadsToImport(): boolean {
        const recoveryDir = this.getRecoveryDirPath();
        if (!recoveryDir || !fs.existsSync(recoveryDir)) { return false; }
        return fs.readdirSync(recoveryDir).some(f => f.endsWith(RECOVERY_EXT));
    }

    /** Returns the number of scratch pads from Kusto Explorer to import. */
    getScratchPadsToImportCount(): number {
        return this.getScratchPadRecoveryFiles()?.length ?? 0;
    }

    // ─── Import Connections ──────────────────────────────────────────

    /**
     * Imports connections from Kusto Explorer.
     * Reads the groups XML, parses each group's connections file, and adds
     * servers to the ConnectionManager, skipping duplicates.
     * @returns The result with imported and skipped counts, or undefined if no groups file found.
     */
    async importConnections(): Promise<ImportConnectionsResult | undefined> {
        const groupsPath = this.getGroupsFilePath();
        if (!groupsPath || !fs.existsSync(groupsPath)) {
            return undefined;
        }

        const groups = parseGroupsXml(await fs.promises.readFile(groupsPath, 'utf-8'));
        if (groups.length === 0) {
            return { importedCount: 0, skippedCount: 0 };
        }

        let importedCount = 0;
        let skippedCount = 0;

        for (const group of groups) {
            if (!fs.existsSync(group.filePath)) {
                continue;
            }

            const xml = await fs.promises.readFile(group.filePath, 'utf-8');
            const servers = await parseConnectionsXml(xml, this.connections);
            if (servers.length === 0) {
                continue;
            }

            const isDefaultGroup = group.name === DEFAULT_GROUP_NAME;

            // Ensure the group exists (unless it's the default root group)
            if (!isDefaultGroup) {
                const existing = this.connections.getServersAndGroups();
                const groupExists = existing.items.some(
                    item => isServerGroup(item) && item.name === group.name
                );
                if (!groupExists) {
                    const newGroup: ServerGroupInfo = { name: group.name, servers: [] };
                    await this.connections.addServerGroup(newGroup);
                }
            }

            for (const server of servers) {
                // Check for duplicates by cluster hostname
                if (this.connections.findServerInfo(server.cluster)) {
                    skippedCount++;
                    continue;
                }

                await this.connections.addServer(server, isDefaultGroup ? undefined : group.name);
                importedCount++;
            }
        }

        return { importedCount, skippedCount };
    }

    // ─── Import Scratch Pads ─────────────────────────────────────────

    /**
     * Gets the list of recoverable scratch pad files from Kusto Explorer.
     * Returns undefined if none are found.
     */
    private getScratchPadRecoveryFiles(): KustoExplorerRecoveryFile[] | undefined {
        const recoveryDir = this.getRecoveryDirPath();
        if (!recoveryDir || !fs.existsSync(recoveryDir)) {
            return undefined;
        }

        const kebakFiles = fs.readdirSync(recoveryDir).filter(f => f.endsWith(RECOVERY_EXT));
        if (kebakFiles.length === 0) {
            return undefined;
        }

        const entries: KustoExplorerRecoveryFile[] = [];
        for (const file of kebakFiles) {
            try {
                const raw = fs.readFileSync(path.join(recoveryDir, file), 'utf-8');
                const entry: KustoExplorerRecoveryFile = JSON.parse(raw);
                // Only import scratch pad documents (no FullPath). Files with a
                // FullPath were already saved to disk and are just recovery backups.
                if (entry.QueryText?.trim() && !entry.FullPath?.trim()) {
                    entries.push(entry);
                }
            } catch {
                // Skip malformed files
            }
        }

        if (entries.length === 0) {
            return undefined;
        }

        // Sort by tab ordinal to preserve the user's tab order
        entries.sort((a, b) => (a.TabOrdinal ?? 0) - (b.TabOrdinal ?? 0));
        return entries;
    }

    /**
     * Imports scratch pad recovery files as scratch pad documents.
     * @returns The result with imported count, or undefined if no recovery files found.
     */
    async importScratchPads(): Promise<ImportScratchPadsResult | undefined> {
        const recoveryFiles = this.getScratchPadRecoveryFiles();
        if (!recoveryFiles) {
            return undefined;
        }

        const importedCount = await this.importRecoveryFiles(recoveryFiles);
        return { importedCount };
    }

    /**
     * Imports a list of recovery files as scratch pad files.
     * Returns the number of successfully imported entries.
     */
    private async importRecoveryFiles(recoveryFiles: KustoExplorerRecoveryFile[]): Promise<number> {
        let importedCount = 0;
        for (const recoveryFile of recoveryFiles) {
            // Resolve the connection first so we can use the friendly name for naming
            let cluster: string | undefined;
            let database: string | undefined;
            if (recoveryFile.ConnectionString) {
                try {
                    cluster = await this.connections.getHostName(recoveryFile.ConnectionString);
                    database = parseDatabaseFromConnectionString(recoveryFile.ConnectionString);
                    if (cluster && !this.connections.findServerInfo(cluster)) {
                        const server: ServerInfo = {
                            connection: recoveryFile.ConnectionString,
                            cluster,
                        };
                        const serverKind = await this.connections.fetchServerKind(recoveryFile.ConnectionString);
                        if (serverKind) {
                            server.serverKind = serverKind;
                        }
                        await this.connections.addServer(server);
                    }
                } catch {
                    // Connection resolution is best-effort; don't block import
                }
            }

            // Determine the scratch pad name:
            // 1. Use CustomTitle if the user named it
            // 2. Derive from connection.database (matching Kusto Explorer's convention)
            // 3. Fall back to auto-naming (ScratchPad<N>)
            const customTitle = recoveryFile.CustomTitle?.trim() || null;
            let name: string | null;
            if (customTitle) {
                name = sanitizeFileName(customTitle);
            } else if (cluster) {
                const serverInfo = this.connections.findServerInfo(cluster);
                const connectionName = serverInfo?.displayName ?? cluster;
                name = database ? sanitizeFileName(`${connectionName}.${database}`) : sanitizeFileName(connectionName);
            } else {
                name = null;
            }

            const finalName = await this.scratchPadManager.addScratchPadFile(name, recoveryFile.QueryText!);

            // Associate the connection with the new scratch pad
            if (cluster) {
                try {
                    const scratchUri = `kustoTraceTools-scratch:/${finalName}`;
                    await this.connections.setDocumentConnection(scratchUri, cluster, database);
                } catch {
                    // Connection association is best-effort; don't block import
                }
            }

            importedCount++;
        }
        return importedCount;
    }

    // ─── Path Helpers ────────────────────────────────────────────────

    /** Returns the path to UserConnectionGroups.xml, or undefined. */
    private getGroupsFilePath(): string | undefined {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) { return undefined; }
        return path.join(localAppData, KUSTO_EXPLORER_DIR, GROUPS_FILE);
    }

    /** Returns the path to the Kusto Explorer Recovery directory, or undefined. */
    private getRecoveryDirPath(): string | undefined {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) { return undefined; }
        return path.join(localAppData, KUSTO_EXPLORER_DIR, RECOVERY_DIR);
    }
}

// =============================================================================
// Pure Parsing Functions
// =============================================================================

const xmlParser = new XMLParser();

/**
 * Sanitizes a string for use as a filename by removing characters
 * that are invalid on Windows/macOS/Linux.
 */
export function sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'ScratchPad';
}

/**
 * Extracts the database name (Initial Catalog) from a Kusto connection string.
 * Returns undefined if the database is "NetDefaultDB" (Kusto Explorer's placeholder).
 */
export function parseDatabaseFromConnectionString(connectionString: string): string | undefined {
    const match = connectionString.match(/Initial Catalog\s*=\s*([^;]+)/i);
    const database = match?.[1]?.trim();
    if (!database || database === 'NetDefaultDB') {
        return undefined;
    }
    return database;
}

/**
 * Parses UserConnectionGroups.xml to get group names and their connection file paths.
 */
export function parseGroupsXml(xml: string): { name: string; filePath: string }[] {
    const doc = xmlParser.parse(xml);
    const entries = doc?.ArrayOfServerGroupDescription?.ServerGroupDescription;
    if (!entries) { return []; }
    const list = Array.isArray(entries) ? entries : [entries];
    return list
        .filter((e: any) => e.Name && e.Details)
        .map((e: any) => ({
            name: e.Name as string,
            filePath: e.Details as string,
        }));
}

/**
 * Parses a UserConnections.xml (or group connections file) into ServerInfo[].
 */
export async function parseConnectionsXml(xml: string, connections: ConnectionManager): Promise<ServerInfo[]> {
    const doc = xmlParser.parse(xml);
    const entries = doc?.ArrayOfServerDescriptionBase?.ServerDescriptionBase;
    if (!entries) { return []; }
    const list = Array.isArray(entries) ? entries : [entries];

    const results: ServerInfo[] = [];
    for (const entry of list) {
        const connectionString = entry.ConnectionString;
        if (!connectionString) { continue; }

        const cluster = await connections.getHostName(connectionString);
        const displayName = entry.Name as string | undefined;

        const server: ServerInfo = {
            connection: connectionString,
            cluster,
        };

        // Use the KE display name if it differs from the cluster hostname
        if (displayName && displayName !== cluster) {
            server.displayName = displayName;
        }

        // Fetch server kind (e.g. DataManager, ClusterManager) from the server API
        const serverKind = await connections.fetchServerKind(connectionString);
        if (serverKind) {
            server.serverKind = serverKind;
        }

        results.push(server);
    }

    return results;
}
