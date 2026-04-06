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

	context.subscriptions.push(
		vscode.commands.registerCommand('kaitai-struct.openViewer', () => {
			KaitaiPanels.createOrShow(context);
		}),
		vscode.commands.registerCommand('kaitai-struct.selectBinaryFile', async () => {
			await KaitaiPanels.pickBinaryFile(context);
		}),
	);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
