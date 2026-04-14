import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConverterViewProvider } from './converterViewProvider';

type KsyMsg =
	| { type: 'update'; ksyYaml: string; bufferHex: string }
	| { type: 'binaryOnly'; bufferHex: string };

type HighlightMsg =
	| { type: 'setHover'; range: { start: number; end: number } | null }
	| { type: 'setSelect'; range: { start: number; end: number } | null };

export class KaitaiPanels {
	private static ctx: vscode.ExtensionContext | undefined;
	private static binaryPath: string | undefined;
	private static binaryBuffer: Buffer | undefined;
	private static lastKsyYaml: string | undefined;
	private static hexPanel: vscode.WebviewPanel | undefined;
	private static treePanel: vscode.WebviewPanel | undefined;
	private static converterProvider: ConverterViewProvider | undefined;
	private static listenersSetup = false;
	private static disposables: vscode.Disposable[] = [];
	private static panelReady: { hex: boolean; tree: boolean } = { hex: false, tree: false };
	private static panelPending: { hex?: KsyMsg; tree?: KsyMsg } = {};

	static setConverterProvider(p: ConverterViewProvider): void {
		KaitaiPanels.converterProvider = p;
	}

	static createOrShow(context: vscode.ExtensionContext): void {
		KaitaiPanels.ctx = context;
		if (!KaitaiPanels.listenersSetup) {
			KaitaiPanels.setupListeners(context);
			KaitaiPanels.listenersSetup = true;
		}
		const initialMsg = KaitaiPanels.currentMsg();
		KaitaiPanels.ensurePanel('hex', initialMsg);
		KaitaiPanels.ensurePanel('tree', initialMsg);
	}

	private static ensurePanel(type: 'hex' | 'tree', initialMsg: KsyMsg | undefined): void {
		const existing = type === 'hex' ? KaitaiPanels.hexPanel : KaitaiPanels.treePanel;
		if (existing) {
			if (initialMsg) existing.webview.postMessage(initialMsg);
			existing.reveal();
			return;
		}

		if (initialMsg) KaitaiPanels.panelPending[type] = initialMsg;

		const context = KaitaiPanels.ctx!;
		const panel = vscode.window.createWebviewPanel(
			type === 'hex' ? 'kaitaiHex' : 'kaitaiTree',
			type === 'hex' ? 'Kaitai Hex' : 'Kaitai Tree',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist')],
				retainContextWhenHidden: true,
			}
		);
		if (type === 'hex') KaitaiPanels.hexPanel = panel;
		else KaitaiPanels.treePanel = panel;

		panel.webview.html = KaitaiPanels.buildHtml(panel, type);
		panel.webview.onDidReceiveMessage((msg: HighlightMsg | { type: 'ready' }) => {
			if (msg.type === 'ready') {
				KaitaiPanels.panelReady[type] = true;
				const pending = KaitaiPanels.panelPending[type];
				if (pending) {
					panel.webview.postMessage(pending);
					delete KaitaiPanels.panelPending[type];
				}
				return;
			}
			KaitaiPanels.relayHighlight(type, msg as HighlightMsg);
		});
		panel.onDidDispose(() => {
			if (type === 'hex') KaitaiPanels.hexPanel = undefined;
			else KaitaiPanels.treePanel = undefined;
			KaitaiPanels.panelReady[type] = false;
			delete KaitaiPanels.panelPending[type];
		});
	}

	private static relayHighlight(from: 'hex' | 'tree', msg: HighlightMsg): void {
		const target = from === 'hex' ? KaitaiPanels.treePanel : KaitaiPanels.hexPanel;
		target?.webview.postMessage(msg);
		if (msg.type === 'setSelect' && msg.range !== null && KaitaiPanels.binaryBuffer) {
			const start = msg.range?.start ?? 0;
			KaitaiPanels.converterProvider?.updateBytes(
				Array.from(KaitaiPanels.binaryBuffer.slice(start, start + 8))
			);
		}
	}

	static async pickBinaryFile(context: vscode.ExtensionContext): Promise<void> {
		KaitaiPanels.createOrShow(context);
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: 'Select binary file to parse',
		});
		if (!uris?.[0]) return;
		await KaitaiPanels.loadBinary(uris[0].fsPath);
	}

	static async selectBinaryPath(fsPath: string): Promise<void> {
		await KaitaiPanels.loadBinary(fsPath);
	}

	static async loadHexInput(hex: string): Promise<void> {
		let buf: Buffer;
		try {
			buf = KaitaiPanels.hexStringToBuffer(hex);
		} catch (e) {
			vscode.window.showErrorMessage(`Kaitai: invalid hex input — ${e}`);
			return;
		}
		KaitaiPanels.binaryBuffer = buf;
		KaitaiPanels.binaryPath = undefined;
		KaitaiPanels.converterProvider?.updateBytes(Array.from(buf.slice(0, 8)));
		await KaitaiPanels.resolveAndSendKsy();
	}

	private static hexStringToBuffer(hex: string): Buffer {
		const cleaned = hex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
		if (cleaned.length === 0) throw new Error('no hex data found in input');
		const padded = cleaned.length % 2 !== 0 ? cleaned + '0' : cleaned;
		const bytes = Buffer.alloc(padded.length / 2);
		for (let i = 0; i < padded.length; i += 2) {
			bytes[i / 2] = parseInt(padded.substring(i, i + 2), 16);
		}
		return bytes;
	}

	private static async loadBinary(fsPath: string): Promise<void> {
		try {
			KaitaiPanels.binaryBuffer = fs.readFileSync(fsPath);
			KaitaiPanels.binaryPath = fsPath;
		} catch (e) {
			vscode.window.showErrorMessage(`Kaitai: cannot read binary file — ${e}`);
			return;
		}
		KaitaiPanels.converterProvider?.updateBytes(
			Array.from(KaitaiPanels.binaryBuffer.slice(0, 8))
		);
		await KaitaiPanels.resolveAndSendKsy();
	}

	/** Find the best KSY to use and send it, falling back to binary-only. */
	private static async resolveAndSendKsy(): Promise<void> {
		// 1. Already known from an editor change event — most reliable.
		if (KaitaiPanels.lastKsyYaml) {
			KaitaiPanels.sendKsy(KaitaiPanels.lastKsyYaml);
			return;
		}

		// 2. Currently active text editor.
		const activeDoc = vscode.window.activeTextEditor?.document;
		if (KaitaiPanels.isKsy(activeDoc)) {
			KaitaiPanels.sendKsy(activeDoc!.getText());
			return;
		}

		// 3. Any open text document (covers unfocused editors).
		const openKsy = vscode.workspace.textDocuments.find(KaitaiPanels.isKsy);
		if (openKsy) {
			KaitaiPanels.sendKsy(openKsy.getText());
			return;
		}

		// 4. Workspace file search — use only when there is exactly one match
		//    to avoid ambiguity.
		const ksyUris = await vscode.workspace.findFiles('**/*.ksy');
		if (ksyUris.length === 1) {
			const doc = await vscode.workspace.openTextDocument(ksyUris[0]);
			KaitaiPanels.sendKsy(doc.getText());
			return;
		}

		KaitaiPanels.sendBinaryOnly();
	}

	private static isKsy(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
		return !!doc && (doc.languageId === 'kaitai-struct' || doc.fileName.endsWith('.ksy'));
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

		const activeKsy = vscode.window.activeTextEditor?.document;
		if (activeKsy?.languageId === 'kaitai-struct') {
			KaitaiPanels.lastKsyYaml = activeKsy.getText();
		}
	}

	private static bufferToHex(buf: Buffer): string {
		return buf.toString('hex').replace(/(.{2})/g, '$1 ').trim();
	}

	private static sendToPanel(type: 'hex' | 'tree', msg: KsyMsg): void {
		const panel = type === 'hex' ? KaitaiPanels.hexPanel : KaitaiPanels.treePanel;
		if (!panel) return;
		if (KaitaiPanels.panelReady[type]) {
			panel.webview.postMessage(msg);
		} else {
			KaitaiPanels.panelPending[type] = msg;
		}
	}

	private static sendKsy(ksyYaml: string): void {
		KaitaiPanels.lastKsyYaml = ksyYaml;
		if (!KaitaiPanels.binaryBuffer) return;
		const bufferHex = KaitaiPanels.bufferToHex(KaitaiPanels.binaryBuffer);
		const msg: KsyMsg = { type: 'update', ksyYaml, bufferHex };
		KaitaiPanels.sendToPanel('hex', msg);
		KaitaiPanels.sendToPanel('tree', msg);
	}

	private static sendBinaryOnly(): void {
		if (!KaitaiPanels.binaryBuffer) return;
		const bufferHex = KaitaiPanels.bufferToHex(KaitaiPanels.binaryBuffer);
		const msg: KsyMsg = { type: 'binaryOnly', bufferHex };
		KaitaiPanels.sendToPanel('hex', msg);
		KaitaiPanels.sendToPanel('tree', msg);
	}

	private static currentMsg(): KsyMsg | undefined {
		if (!KaitaiPanels.binaryBuffer) return undefined;
		const bufferHex = KaitaiPanels.bufferToHex(KaitaiPanels.binaryBuffer);
		if (KaitaiPanels.lastKsyYaml) {
			return { type: 'update', ksyYaml: KaitaiPanels.lastKsyYaml, bufferHex };
		}
		return { type: 'binaryOnly', bufferHex };
	}

	private static buildHtml(panel: vscode.WebviewPanel, panelType: 'hex' | 'tree'): string {
		const context = KaitaiPanels.ctx!;
		const distUri = vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist');
		const indexPath = path.join(distUri.fsPath, 'index.html');
		let html = fs.readFileSync(indexPath, 'utf-8');

		html = html.replace(/(src|href)="(\.\/[^"]+)"/g, (_, attr, relPath) => {
			const absUri = vscode.Uri.joinPath(distUri, relPath.replace(/^\.\//, ''));
			return `${attr}="${panel.webview.asWebviewUri(absUri)}"`;
		});

		const csp = [
			`default-src 'none'`,
			`script-src 'unsafe-eval' ${panel.webview.cspSource}`,
			`style-src ${panel.webview.cspSource} 'unsafe-inline'`,
			`font-src ${panel.webview.cspSource}`,
			`img-src ${panel.webview.cspSource} data:`,
		].join('; ');

		return html
			.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
			.replace(/<head[^>]*>/i, match =>
				`${match}\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="kaitai-panel" content="${panelType}">`
			);
	}
}
