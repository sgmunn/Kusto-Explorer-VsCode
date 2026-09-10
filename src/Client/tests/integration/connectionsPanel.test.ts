// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ConnectionManager } from '../../features/connectionManager';
import { isServer, isServerGroup } from '../../features/connectionManager';
import type { ServerInfo, ServerGroupInfo } from '../../features/connectionManager';

/** Get the extension's exported ConnectionManager instance. */
async function getConnectionManager(): Promise<ConnectionManager> {
    const ext = vscode.extensions.getExtension('local.kustotracetools')!;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return (exports as any).connectionManager as ConnectionManager;
}

/** Helper to find a server in the connections data (at root or in a group). */
function findServer(cm: ConnectionManager, cluster: string): { server: ServerInfo; groupName?: string } | undefined {
    for (const item of cm.getServersAndGroups().items) {
        if (isServer(item) && item.cluster === cluster) {
            return { server: item };
        }
        if (isServerGroup(item)) {
            const server = item.servers.find(s => s.cluster === cluster);
            if (server) {
                return { server, groupName: item.name };
            }
        }
    }
    return undefined;
}

/** Helper to find a group in the connections data. */
function findGroup(cm: ConnectionManager, name: string): ServerGroupInfo | undefined {
    for (const item of cm.getServersAndGroups().items) {
        if (isServerGroup(item) && item.name === name) {
            return item;
        }
    }
    return undefined;
}

suite('Connections Panel Integration Tests', () => {
    let connectionManager: ConnectionManager;

    suiteSetup(async () => {
        connectionManager = await getConnectionManager();
    });

    setup(async () => {
        // Clear all servers and groups before each test
        const data = connectionManager.getServersAndGroups();
        for (const item of [...data.items]) {
            if (isServerGroup(item)) {
                await connectionManager.removeServerGroup(item.name);
            } else if (isServer(item)) {
                await connectionManager.removeServer(item.cluster);
            }
        }
    });

    teardown(async () => {
        // Clear all servers and groups after each test
        const data = connectionManager.getServersAndGroups();
        for (const item of [...data.items]) {
            if (isServerGroup(item)) {
                await connectionManager.removeServerGroup(item.name);
            } else if (isServer(item)) {
                await connectionManager.removeServer(item.cluster);
            }
        }
    });

    test('Add a server via command', async () => {
        assert.strictEqual(
            connectionManager.getServersAndGroups().items.length, 0,
            'Should start with no connections'
        );

        // Stub showInputBox to return a connection URL
        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'https://testcluster.kusto.windows.net';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.addServer');
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        const result = findServer(connectionManager, 'testcluster.kusto.windows.net');
        assert.ok(result, 'Server should exist after adding');
        assert.strictEqual(result.server.cluster, 'testcluster.kusto.windows.net');
        assert.strictEqual(result.groupName, undefined, 'Server should be at root level');
    });

    test('Remove a server via command', async () => {
        // Add a server directly
        await connectionManager.addServer({
            connection: 'https://mycluster.kusto.windows.net',
            cluster: 'mycluster.kusto.windows.net',
        });
        assert.ok(findServer(connectionManager, 'mycluster.kusto.windows.net'), 'Server should exist');

        // Stub showWarningMessage to confirm removal
        const original = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => 'Remove';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.removeServer', {
                clusterName: 'mycluster.kusto.windows.net',
                displayName: 'mycluster',
            });
        } finally {
            (vscode.window as any).showWarningMessage = original;
        }

        assert.strictEqual(
            findServer(connectionManager, 'mycluster.kusto.windows.net'),
            undefined,
            'Server should be removed'
        );
    });

    test('Add a server group via command', async () => {
        // Stub showInputBox to return a group name
        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'Production';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.addServerGroup');
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        const group = findGroup(connectionManager, 'Production');
        assert.ok(group, 'Group should exist after adding');
        assert.strictEqual(group.servers.length, 0, 'New group should have no servers');
    });

    test('Remove a server group via command', async () => {
        // Add a group with a server in it
        await connectionManager.addServerGroup({ name: 'TestGroup', servers: [] });
        await connectionManager.addServer({
            connection: 'https://grouped.kusto.windows.net',
            cluster: 'grouped.kusto.windows.net',
        }, 'TestGroup');
        assert.ok(findGroup(connectionManager, 'TestGroup'), 'Group should exist');

        // Stub showWarningMessage to confirm removal
        const original = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => 'Remove';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.removeServerGroup', {
                groupInfo: { name: 'TestGroup' },
            });
        } finally {
            (vscode.window as any).showWarningMessage = original;
        }

        assert.strictEqual(findGroup(connectionManager, 'TestGroup'), undefined, 'Group should be removed');
        assert.strictEqual(
            findServer(connectionManager, 'grouped.kusto.windows.net'),
            undefined,
            'Server in the group should also be removed'
        );
    });

    test('Rename a server via command', async () => {
        await connectionManager.addServer({
            connection: 'https://renameme.kusto.windows.net',
            cluster: 'renameme.kusto.windows.net',
            displayName: 'renameme',
        });

        // Stub showInputBox to return new name
        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'NewDisplayName';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.renameServer', {
                clusterName: 'renameme.kusto.windows.net',
                displayName: 'renameme',
            });
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        const result = findServer(connectionManager, 'renameme.kusto.windows.net');
        assert.ok(result, 'Server should still exist');
        assert.strictEqual(result.server.displayName, 'NewDisplayName', 'Display name should be updated');
    });

    test('Rename a server group via command', async () => {
        await connectionManager.addServerGroup({ name: 'OldGroupName', servers: [] });
        await connectionManager.addServer({
            connection: 'https://ingroup.kusto.windows.net',
            cluster: 'ingroup.kusto.windows.net',
        }, 'OldGroupName');

        // Stub showInputBox to return new group name
        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'NewGroupName';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.renameServerGroup', {
                groupInfo: { name: 'OldGroupName' },
            });
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        assert.strictEqual(findGroup(connectionManager, 'OldGroupName'), undefined, 'Old group name should be gone');
        const group = findGroup(connectionManager, 'NewGroupName');
        assert.ok(group, 'Group should exist with new name');
        assert.strictEqual(group.servers.length, 1, 'Servers should be preserved after rename');
        assert.strictEqual(group.servers[0].cluster, 'ingroup.kusto.windows.net');
    });

    test('Move a server to a group via command', async () => {
        // Create a group and a root-level server
        await connectionManager.addServerGroup({ name: 'TargetGroup', servers: [] });
        await connectionManager.addServer({
            connection: 'https://moveme.kusto.windows.net',
            cluster: 'moveme.kusto.windows.net',
        });

        // Verify server is at root
        let result = findServer(connectionManager, 'moveme.kusto.windows.net');
        assert.ok(result, 'Server should exist');
        assert.strictEqual(result.groupName, undefined, 'Server should start at root');

        // Stub showQuickPick to select the target group
        const original = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => ({
            label: '$(folder) TargetGroup',
            description: 'Move to group "TargetGroup"',
        });
        try {
            await vscode.commands.executeCommand('kustoTraceTools.moveServer', {
                clusterName: 'moveme.kusto.windows.net',
                displayName: 'moveme',
            });
        } finally {
            (vscode.window as any).showQuickPick = original;
        }

        result = findServer(connectionManager, 'moveme.kusto.windows.net');
        assert.ok(result, 'Server should still exist');
        assert.strictEqual(result.groupName, 'TargetGroup', 'Server should be in the target group');
    });

    test('Move a server from a group back to root', async () => {
        await connectionManager.addServerGroup({ name: 'MyGroup', servers: [] });
        await connectionManager.addServer({
            connection: 'https://moveback.kusto.windows.net',
            cluster: 'moveback.kusto.windows.net',
        }, 'MyGroup');

        let result = findServer(connectionManager, 'moveback.kusto.windows.net');
        assert.strictEqual(result?.groupName, 'MyGroup', 'Server should start in group');

        const original = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => ({
            label: '$(home) Root',
            description: 'Move to root level',
        });
        try {
            await vscode.commands.executeCommand('kustoTraceTools.moveServer', {
                clusterName: 'moveback.kusto.windows.net',
                displayName: 'moveback',
                groupName: 'MyGroup',
            });
        } finally {
            (vscode.window as any).showQuickPick = original;
        }

        result = findServer(connectionManager, 'moveback.kusto.windows.net');
        assert.ok(result, 'Server should still exist');
        assert.strictEqual(result.groupName, undefined, 'Server should be at root');
    });

    test('Move a server between groups', async () => {
        await connectionManager.addServerGroup({ name: 'GroupA', servers: [] });
        await connectionManager.addServerGroup({ name: 'GroupB', servers: [] });
        await connectionManager.addServer({
            connection: 'https://between.kusto.windows.net',
            cluster: 'between.kusto.windows.net',
        }, 'GroupA');

        let result = findServer(connectionManager, 'between.kusto.windows.net');
        assert.strictEqual(result?.groupName, 'GroupA', 'Server should start in GroupA');

        const original = vscode.window.showQuickPick;
        (vscode.window as any).showQuickPick = async () => ({
            label: '$(folder) GroupB',
            description: 'Move to group "GroupB"',
        });
        try {
            await vscode.commands.executeCommand('kustoTraceTools.moveServer', {
                clusterName: 'between.kusto.windows.net',
                displayName: 'between',
                groupName: 'GroupA',
            });
        } finally {
            (vscode.window as any).showQuickPick = original;
        }

        result = findServer(connectionManager, 'between.kusto.windows.net');
        assert.ok(result, 'Server should still exist');
        assert.strictEqual(result.groupName, 'GroupB', 'Server should be in GroupB');
        assert.strictEqual(findGroup(connectionManager, 'GroupA')?.servers.length, 0, 'GroupA should be empty');
    });

    test('Add a server directly to a group via command', async () => {
        await connectionManager.addServerGroup({ name: 'DirectGroup', servers: [] });

        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'https://direct.kusto.windows.net';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.addServerToGroup', {
                groupInfo: { name: 'DirectGroup' },
            });
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        const result = findServer(connectionManager, 'direct.kusto.windows.net');
        assert.ok(result, 'Server should exist');
        assert.strictEqual(result.groupName, 'DirectGroup', 'Server should be in the specified group');
    });

    test('Edit a server connection via command', async () => {
        await connectionManager.addServer({
            connection: 'https://old.kusto.windows.net',
            cluster: 'old.kusto.windows.net',
            displayName: 'old',
        });

        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'https://new.kusto.windows.net';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.editServer', {
                connection: 'https://old.kusto.windows.net',
                clusterName: 'old.kusto.windows.net',
                displayName: 'old',
            });
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        assert.strictEqual(
            findServer(connectionManager, 'old.kusto.windows.net'),
            undefined,
            'Old cluster should no longer exist'
        );
        const result = findServer(connectionManager, 'new.kusto.windows.net');
        assert.ok(result, 'New cluster should exist');
    });

    test('Add server cancelled when user dismisses input', async () => {
        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.addServer');
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        assert.strictEqual(
            connectionManager.getServersAndGroups().items.length, 0,
            'No server should be added when input is cancelled'
        );
    });

    test('Remove server cancelled when user dismisses confirmation', async () => {
        await connectionManager.addServer({
            connection: 'https://keepme.kusto.windows.net',
            cluster: 'keepme.kusto.windows.net',
        });

        const original = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async () => undefined;
        try {
            await vscode.commands.executeCommand('kustoTraceTools.removeServer', {
                clusterName: 'keepme.kusto.windows.net',
                displayName: 'keepme',
            });
        } finally {
            (vscode.window as any).showWarningMessage = original;
        }

        assert.ok(
            findServer(connectionManager, 'keepme.kusto.windows.net'),
            'Server should still exist after cancelling removal'
        );
    });

    test('Rename server is no-op when user enters same name', async () => {
        await connectionManager.addServer({
            connection: 'https://samename.kusto.windows.net',
            cluster: 'samename.kusto.windows.net',
            displayName: 'samename',
        });

        const original = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => 'samename';
        try {
            await vscode.commands.executeCommand('kustoTraceTools.renameServer', {
                clusterName: 'samename.kusto.windows.net',
                displayName: 'samename',
            });
        } finally {
            (vscode.window as any).showInputBox = original;
        }

        const result = findServer(connectionManager, 'samename.kusto.windows.net');
        assert.ok(result, 'Server should still exist');
        assert.strictEqual(result.server.displayName, 'samename', 'Display name should remain unchanged');
    });

    test('getConfiguredConnections returns all clusters', async () => {
        await connectionManager.addServerGroup({ name: 'TestGroup', servers: [] });
        await connectionManager.addServer({
            connection: 'https://root1.kusto.windows.net',
            cluster: 'root1.kusto.windows.net',
        });
        await connectionManager.addServer({
            connection: 'https://grouped1.kusto.windows.net',
            cluster: 'grouped1.kusto.windows.net',
        }, 'TestGroup');
        await connectionManager.addServer({
            connection: 'https://root2.kusto.windows.net',
            cluster: 'root2.kusto.windows.net',
        });

        const connections = connectionManager.getConfiguredConnections();
        assert.strictEqual(connections.length, 3, 'Should return all 3 clusters');
        assert.ok(connections.includes('root1.kusto.windows.net'));
        assert.ok(connections.includes('root2.kusto.windows.net'));
        assert.ok(connections.includes('grouped1.kusto.windows.net'));
    });

    test('findServerInfo finds servers in root and groups', async () => {
        await connectionManager.addServerGroup({ name: 'FindGroup', servers: [] });
        await connectionManager.addServer({
            connection: 'https://rootfind.kusto.windows.net',
            cluster: 'rootfind.kusto.windows.net',
        });
        await connectionManager.addServer({
            connection: 'https://groupfind.kusto.windows.net',
            cluster: 'groupfind.kusto.windows.net',
        }, 'FindGroup');

        assert.ok(connectionManager.findServerInfo('rootfind.kusto.windows.net'), 'Should find root server');
        assert.ok(connectionManager.findServerInfo('groupfind.kusto.windows.net'), 'Should find grouped server');
        assert.strictEqual(connectionManager.findServerInfo('nonexistent.kusto.windows.net'), undefined, 'Should return undefined for non-existent');
    });

    test('Servers and groups are sorted alphabetically', async () => {
        await connectionManager.addServer({
            connection: 'https://zebra.kusto.windows.net',
            cluster: 'zebra.kusto.windows.net',
        });
        await connectionManager.addServer({
            connection: 'https://alpha.kusto.windows.net',
            cluster: 'alpha.kusto.windows.net',
        });
        await connectionManager.addServerGroup({ name: 'Zulu', servers: [] });
        await connectionManager.addServerGroup({ name: 'Bravo', servers: [] });

        const items = connectionManager.getServersAndGroups().items;
        // Servers come first, then groups, each sorted alphabetically
        assert.ok(isServer(items[0]) && items[0].cluster === 'alpha.kusto.windows.net', 'First should be alpha server');
        assert.ok(isServer(items[1]) && items[1].cluster === 'zebra.kusto.windows.net', 'Second should be zebra server');
        assert.ok(isServerGroup(items[2]) && items[2].name === 'Bravo', 'Third should be Bravo group');
        assert.ok(isServerGroup(items[3]) && items[3].name === 'Zulu', 'Fourth should be Zulu group');
    });
});
