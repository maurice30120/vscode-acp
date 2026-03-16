import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

function getCurrentDevelopmentExtension(): vscode.Extension<any> | undefined {
	const extensionRoot = path.resolve(__dirname, '../..');
	return vscode.extensions.all.find((extension) =>
		extension.packageJSON?.name === 'acp-client'
		&& extension.extensionPath === extensionRoot);
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(getCurrentDevelopmentExtension());
	});

	test('Should activate extension', async () => {
		const ext = getCurrentDevelopmentExtension();
		assert.ok(ext);
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
	});

	test('Should register ACP commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		const acpCommands = commands.filter(c => c.startsWith('acp.'));
		assert.ok(acpCommands.length > 0, 'ACP commands should be registered');
		assert.ok(acpCommands.includes('acp.connectAgent'), 'connectAgent command should exist');
		assert.ok(acpCommands.includes('acp.newConversation'), 'newConversation command should exist');
		assert.ok(acpCommands.includes('acp.openChat'), 'openChat command should exist');
		assert.ok(acpCommands.includes('acp.quickPrompt'), 'quickPrompt command should exist');
	});
});
