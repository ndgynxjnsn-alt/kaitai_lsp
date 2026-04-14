import * as path from 'path';
import { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';
import { KaitaiPanels } from './kaitaiPanel';
import { KsyFilesProvider, BinaryFilesProvider } from './sidebarProviders';
import { ConverterViewProvider } from './converterViewProvider';

let client: LanguageClient;

export async function activate(context: ExtensionContext): Promise<void> {
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ['--nolazy', '--inspect=6009'] },
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'kaitai-struct' }],
	};

	client = new LanguageClient(
		'kaitaiStructLsp',
		'Kaitai Struct Language Server',
		serverOptions,
		clientOptions
	);

	await client.start();

	// Sidebar providers
	const ksyProvider = new KsyFilesProvider(context);
	const binaryProvider = new BinaryFilesProvider();
	const converterProvider = new ConverterViewProvider();
	KaitaiPanels.setConverterProvider(converterProvider);

	vscode.window.registerTreeDataProvider('kaitai.ksyFiles', ksyProvider);
	vscode.window.registerTreeDataProvider('kaitai.binaryFiles', binaryProvider);
	vscode.window.registerWebviewViewProvider(ConverterViewProvider.viewType, converterProvider);

	context.subscriptions.push(
		// Existing panel commands
		vscode.commands.registerCommand('kaitai-struct.openViewer', () => {
			KaitaiPanels.createOrShow(context);
		}),
		vscode.commands.registerCommand('kaitai-struct.selectBinaryFile', async () => {
			await KaitaiPanels.pickBinaryFile(context);
		}),

		// Sidebar commands
		vscode.commands.registerCommand('kaitai-struct.refreshKsy', () => {
			ksyProvider.refresh();
		}),
		vscode.commands.registerCommand('kaitai-struct.setBinaryGlob', async () => {
			const current = binaryProvider.getGlob();
			const input = await vscode.window.showInputBox({
				prompt: 'Glob pattern for binary files (e.g. **/*.bin)',
				value: current,
				placeHolder: '**/*.bin',
			});
			if (input !== undefined) binaryProvider.setGlob(input);
		}),
		vscode.commands.registerCommand('kaitai-struct.selectBinaryPath', async (fsPath: string) => {
			KaitaiPanels.createOrShow(context);
			await KaitaiPanels.selectBinaryPath(fsPath);
		}),
		vscode.commands.registerCommand('kaitai-struct.pasteHex', async () => {
			const input = await vscode.window.showInputBox({
				title: 'Paste Hex String',
				prompt: 'Hex bytes — spaces, 0x-prefix, and colons are all accepted',
				placeHolder: 'CA FE 00 04  or  0xCA 0xFE  or  CA:FE:00:04',
			});
			if (input === undefined) return;
			KaitaiPanels.createOrShow(context);
			await KaitaiPanels.loadHexInput(input);
		}),
		{ dispose: () => binaryProvider.dispose() },
	);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
