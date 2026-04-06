import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type KsyMsg =
	| { type: 'update'; ksyYaml: string; bufferHex: string }
	| { type: 'binaryOnly'; bufferHex: string };

type HighlightMsg =
	| { type: 'setHover'; range: { start: number; end: number } | null }
	| { type: 'setSelect'; range: { start: number; end: number } | null };

type IncomingMsg = HighlightMsg;

export class KaitaiPanels {
	private static ctx: vscode.ExtensionContext | undefined;
	private static binaryPath: string | undefined;
	private static lastKsyYaml: string | undefined;
	private static hexPanel: vscode.WebviewPanel | undefined;
	private static treePanel: vscode.WebviewPanel | undefined;
	private static listenersSetup = false;
	private static disposables: vscode.Disposable[] = [];

	static createOrShow(context: vscode.ExtensionContext): void {
		KaitaiPanels.ctx = context;
		if (!KaitaiPanels.listenersSetup) {
			KaitaiPanels.setupListeners(context);
			KaitaiPanels.listenersSetup = true;
		}
		KaitaiPanels.ensureHexPanel();
		KaitaiPanels.ensureTreePanel();
	}

	private static ensureHexPanel(): void {
		const context = KaitaiPanels.ctx!;
		if (KaitaiPanels.hexPanel) {
			KaitaiPanels.hexPanel.reveal();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'kaitaiHex',
			'Kaitai Hex',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist')],
				retainContextWhenHidden: true,
			}
		);
		KaitaiPanels.hexPanel = panel;
		panel.webview.html = KaitaiPanels.buildHtml(panel, 'hex');
		panel.webview.onDidReceiveMessage((msg: IncomingMsg) =>
			KaitaiPanels.relayHighlight('hex', msg)
		);
		panel.onDidDispose(() => { KaitaiPanels.hexPanel = undefined; });
		KaitaiPanels.sendToPanel(panel, KaitaiPanels.currentMsg());
	}

	private static ensureTreePanel(): void {
		const context = KaitaiPanels.ctx!;
		if (KaitaiPanels.treePanel) {
			KaitaiPanels.treePanel.reveal();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'kaitaiTree',
			'Kaitai Tree',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist')],
				retainContextWhenHidden: true,
			}
		);
		KaitaiPanels.treePanel = panel;
		panel.webview.html = KaitaiPanels.buildHtml(panel, 'tree');
		panel.webview.onDidReceiveMessage((msg: IncomingMsg) =>
			KaitaiPanels.relayHighlight('tree', msg)
		);
		panel.onDidDispose(() => { KaitaiPanels.treePanel = undefined; });
		KaitaiPanels.sendToPanel(panel, KaitaiPanels.currentMsg());
	}

	/** Forward highlight events from one panel to the other. */
	private static relayHighlight(from: 'hex' | 'tree', msg: IncomingMsg): void {
		const target = from === 'hex' ? KaitaiPanels.treePanel : KaitaiPanels.hexPanel;
		target?.webview.postMessage(msg);
	}

	/** Ask the user to pick a binary file, then re-parse. */
	static async pickBinaryFile(context: vscode.ExtensionContext): Promise<void> {
		KaitaiPanels.createOrShow(context);
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: 'Select binary file to parse',
		});
		if (!uris?.[0]) return;
		KaitaiPanels.binaryPath = uris[0].fsPath;

		const activeKsy = vscode.window.activeTextEditor?.document;
		if (activeKsy?.languageId === 'kaitai-struct') {
			KaitaiPanels.sendKsy(activeKsy.getText());
		} else {
			KaitaiPanels.sendBinaryOnly();
		}
	}

	private static setupListeners(context: vscode.ExtensionContext): void {
		KaitaiPanels.disposables.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.languageId === 'kaitai-struct') {
					KaitaiPanels.sendKsy(e.document.getText());
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor?.document.languageId === 'kaitai-struct') {
					KaitaiPanels.sendKsy(editor.document.getText());
				}
			})
		);
		context.subscriptions.push(...KaitaiPanels.disposables);

		// Initial send if a .ksy is already open
		const activeKsy = vscode.window.activeTextEditor?.document;
		if (activeKsy?.languageId === 'kaitai-struct') {
			KaitaiPanels.lastKsyYaml = activeKsy.getText();
		}
	}

	private static sendKsy(ksyYaml: string): void {
		KaitaiPanels.lastKsyYaml = ksyYaml;
		if (!KaitaiPanels.binaryPath) return;
		let bufferHex: string;
		try {
			const buf = fs.readFileSync(KaitaiPanels.binaryPath);
			bufferHex = Buffer.from(buf).toString('hex').replace(/(.{2})/g, '$1 ').trim();
		} catch (e) {
			vscode.window.showErrorMessage(`Kaitai: cannot read binary file — ${e}`);
			return;
		}
		const msg: KsyMsg = { type: 'update', ksyYaml, bufferHex };
		KaitaiPanels.hexPanel?.webview.postMessage(msg);
		KaitaiPanels.treePanel?.webview.postMessage(msg);
	}

	private static sendBinaryOnly(): void {
		if (!KaitaiPanels.binaryPath) return;
		try {
			const buf = fs.readFileSync(KaitaiPanels.binaryPath);
			const bufferHex = Buffer.from(buf).toString('hex').replace(/(.{2})/g, '$1 ').trim();
			const msg: KsyMsg = { type: 'binaryOnly', bufferHex };
			KaitaiPanels.hexPanel?.webview.postMessage(msg);
			KaitaiPanels.treePanel?.webview.postMessage(msg);
		} catch { /* ignore */ }
	}

	/** Returns the message to send when a panel first opens (may be undefined). */
	private static currentMsg(): KsyMsg | undefined {
		if (!KaitaiPanels.binaryPath) return undefined;
		try {
			const buf = fs.readFileSync(KaitaiPanels.binaryPath);
			const bufferHex = Buffer.from(buf).toString('hex').replace(/(.{2})/g, '$1 ').trim();
			if (KaitaiPanels.lastKsyYaml) {
				return { type: 'update', ksyYaml: KaitaiPanels.lastKsyYaml, bufferHex };
			}
			return { type: 'binaryOnly', bufferHex };
		} catch {
			return undefined;
		}
	}

	private static sendToPanel(panel: vscode.WebviewPanel, msg: KsyMsg | undefined): void {
		if (msg) panel.webview.postMessage(msg);
	}

	private static buildHtml(panel: vscode.WebviewPanel, panelType: 'hex' | 'tree'): string {
		const context = KaitaiPanels.ctx!;
		const distUri = vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist');
		const indexPath = path.join(distUri.fsPath, 'index.html');
		let html = fs.readFileSync(indexPath, 'utf-8');

		// Replace all relative asset paths with proper webview URIs
		html = html.replace(/(src|href)="(\.\/[^"]+)"/g, (_, attr, relPath) => {
			const absUri = vscode.Uri.joinPath(distUri, relPath.replace(/^\.\//, ''));
			return `${attr}="${panel.webview.asWebviewUri(absUri)}"`;
		});

		// Inject Content-Security-Policy (unsafe-eval needed for kaitai new Function)
		const csp = [
			`default-src 'none'`,
			`script-src 'unsafe-eval' ${panel.webview.cspSource}`,
			`style-src ${panel.webview.cspSource} 'unsafe-inline'`,
			`font-src ${panel.webview.cspSource}`,
			`img-src ${panel.webview.cspSource} data:`,
		].join('; ');

		// 1. Strip any existing CSP tags from the source HTML to prevent conflicts
		const processedHtml = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '');

		// 2. Safely inject immediately after the opening <head> tag, regardless of attributes
		const replacedHtml = processedHtml.replace(
			/<head[^>]*>/i,
        	(match) => `${match}\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="kaitai-panel" content="${panelType}">`
    );

		return replacedHtml;
	}
}
